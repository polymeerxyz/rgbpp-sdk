import { Collector, buildRgbppLockArgs, genRgbppLaunchCkbVirtualTx, RgbppTokenInfo, appendCkbTxWitnesses, updateCkbTxWithRealBtcTxId, sendCkbTx } from '@rgbpp-sdk/ckb';
import { DataSource, ECPair, bitcoin, NetworkType, sendRgbppUtxos, transactionToHex } from '@rgbpp-sdk/btc';
import { BtcAssetsApi, BtcAssetsApiError } from '@rgbpp-sdk/service';
import { RGBPP_TOKEN_INFO } from './0-rgbpp-token-info';

// BTC SECP256K1 private key
const BTC_TEST_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000001';
// API docs: https://btc-assets-api.testnet.mibao.pro/docs
const BTC_ASSETS_API_URL = 'https://api.rgbpp.io';
// https://btc-assets-api.testnet.mibao.pro/docs/static/index.html#/Token/post_token_generate
const BTC_ASSETS_TOKEN = '';

interface Params {
  ownerRgbppLockArgs: string;
  launchAmount: bigint;
  rgbppTokenInfo: RgbppTokenInfo;
}
const launchRgppAsset = async ({ ownerRgbppLockArgs, launchAmount, rgbppTokenInfo }: Params) => {
  const collector = new Collector({
    ckbNodeUrl: 'https://mainnet.ckb.dev/rpc',
    ckbIndexerUrl: 'https://mainnet.ckb.dev/indexer',
  });
  const isMainnet = true;

  const network = bitcoin.networks.bitcoin;
  const keyPair = ECPair.fromPrivateKey(Buffer.from(BTC_TEST_PRIVATE_KEY, 'hex'), { network });
  const { address: btcAddress } = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network,
  });

  console.log('btc address: ', btcAddress);

  const networkType = NetworkType.MAINNET;
  const service = BtcAssetsApi.fromToken(BTC_ASSETS_API_URL, BTC_ASSETS_TOKEN, 'https://api.rgbpp.io');
  const source = new DataSource(service, networkType);

  const ckbVirtualTxResult = await genRgbppLaunchCkbVirtualTx({
    collector,
    ownerRgbppLockArgs,
    rgbppTokenInfo,
    launchAmount,
    isMainnet,
  });

  const { commitment, ckbRawTx } = ckbVirtualTxResult;

  console.log('RGB++ Asset type args: ', ckbRawTx.outputs[0].type?.args);

  // Send BTC tx
  const psbt = await sendRgbppUtxos({
    ckbVirtualTx: ckbRawTx,
    commitment,
    tos: [btcAddress!],
    ckbCollector: collector,
    from: btcAddress!,
    source,
  });
  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const btcTx = psbt.extractTransaction();
  const btcTxBytes = transactionToHex(btcTx, false);
  const { txid: btcTxId } = await service.sendBtcTransaction(btcTx.toHex());

  console.log('BTC TxId: ', btcTxId);

  const interval = setInterval(async () => {
    try {
      console.log('Waiting for BTC tx and proof to be ready');
      const rgbppApiSpvProof = await service.getRgbppSpvProof(btcTxId, 0);
      clearInterval(interval);
      // Update CKB transaction with the real BTC txId
      const newCkbRawTx = updateCkbTxWithRealBtcTxId({ ckbRawTx, btcTxId, isMainnet });
      const ckbTx = await appendCkbTxWitnesses({
        ckbRawTx: newCkbRawTx,
        btcTxBytes,
        rgbppApiSpvProof,
      });

      const txHash = await sendCkbTx({ collector, signedTx: ckbTx });
      console.info(`RGB++ Asset has been launched and tx hash is ${txHash}`);
    } catch (error) {
      if (!(error instanceof BtcAssetsApiError)) {
        console.error(error);
      }
    }
  }, 30 * 1000);
};

// Use your real BTC UTXO information on the BTC Testnet
// rgbppLockArgs: outIndexU32 + btcTxId
launchRgppAsset({
  ownerRgbppLockArgs: buildRgbppLockArgs(301, '92966139a07e1cce77293df58c360c0a64a83dd651a9a831d37bcf34fa6d882b'),
  rgbppTokenInfo: RGBPP_TOKEN_INFO,
  // The total issuance amount of RGBPP Token, the decimal is determined by RGBPP Token info
  launchAmount: BigInt(2100_0000) * BigInt(10 ** RGBPP_TOKEN_INFO.decimal),
});