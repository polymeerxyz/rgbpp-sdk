import { serializeScript } from '@nervosnetwork/ckb-sdk-utils';
import { BtcAssetsApiError, genBtcBatchTransferCkbVirtualTx, sendRgbppUtxos } from 'rgbpp';
import { RGBPP_TOKEN_INFO } from './0-rgbpp-token-info';
import {
  isMainnet,
  collector,
  btcAddress,
  btcDataSource,
  btcKeyPair,
  btcService,
  CKB_PRIVATE_KEY,
  ckbAddress,
} from '../../env';
import {
  RgbppBtcAddressReceiver,
  appendCkbTxWitnesses,
  appendIssuerCellToBtcBatchTransfer,
  buildRgbppLockArgs,
  getXudtTypeScript,
  sendCkbTx,
  updateCkbTxWithRealBtcTxId,
} from 'rgbpp/ckb';
import { transactionToHex } from 'rgbpp/btc';

interface Params {
  rgbppLockArgsList: string[];
  receivers: RgbppBtcAddressReceiver[];
  xudtTypeArgs: string;
}
const distributeRgbppAssetOnBtc = async ({ rgbppLockArgsList, receivers, xudtTypeArgs }: Params) => {
  // Warning: Please replace with your real xUDT type script here
  const xudtType: CKBComponents.Script = {
    ...getXudtTypeScript(isMainnet),
    // The xUDT type script args is generated by 2-launch-rgbpp.ts, and it can be found from the log
    args: xudtTypeArgs,
  };

  const ckbVirtualTxResult = await genBtcBatchTransferCkbVirtualTx({
    collector,
    rgbppLockArgsList,
    xudtTypeBytes: serializeScript(xudtType),
    rgbppReceivers: receivers,
    isMainnet,
  });

  const { commitment, ckbRawTx, sumInputsCapacity, rgbppChangeOutIndex } = ckbVirtualTxResult;

  // The first output utxo is OP_RETURN
  // Rgbpp change utxo position depends on the number of distributions, if 50 addresses are distributed, then the change utxo position is 51
  console.log('RGB++ asset change utxo out index: ', rgbppChangeOutIndex);

  // Send BTC tx
  const psbt = await sendRgbppUtxos({
    ckbVirtualTx: ckbRawTx,
    commitment,
    tos: receivers.map((receiver) => receiver.toBtcAddress),
    ckbCollector: collector,
    from: btcAddress!,
    source: btcDataSource,
  });
  psbt.signAllInputs(btcKeyPair);
  psbt.finalizeAllInputs();

  const btcTx = psbt.extractTransaction();
  const btcTxBytes = transactionToHex(btcTx, false);
  const { txid: btcTxId } = await btcService.sendBtcTransaction(btcTx.toHex());

  console.log('BTC TxId: ', btcTxId);

  const interval = setInterval(async () => {
    try {
      console.log('Waiting for BTC tx and proof to be ready');
      const rgbppApiSpvProof = await btcService.getRgbppSpvProof(btcTxId, 0);
      clearInterval(interval);
      // Update CKB transaction with the real BTC txId
      const newCkbRawTx = updateCkbTxWithRealBtcTxId({ ckbRawTx, btcTxId, isMainnet });
      const ckbTx = await appendCkbTxWitnesses({
        ckbRawTx: newCkbRawTx,
        btcTxBytes,
        rgbppApiSpvProof,
      });

      const signedTx = await appendIssuerCellToBtcBatchTransfer({
        secp256k1PrivateKey: CKB_PRIVATE_KEY,
        issuerAddress: ckbAddress,
        ckbRawTx: ckbTx,
        collector,
        sumInputsCapacity,
        isMainnet,
      });

      const txHash = await sendCkbTx({ collector, signedTx });
      console.info(`RGB++ Asset has been distributed and tx hash is ${txHash}`);
    } catch (error) {
      if (!(error instanceof BtcAssetsApiError)) {
        console.error(error);
      }
    }
  }, 20 * 1000);
};

// Use your real BTC UTXO information on the BTC Testnet
// rgbppLockArgs: outIndexU32 + btcTxId
distributeRgbppAssetOnBtc({
  // Warning: If rgbpp assets are distributed continuously, then the position of the current rgbpp asset utxo depends on the position of the previous change utxo distributed
  rgbppLockArgsList: [buildRgbppLockArgs(2, '012bfee9c1e8a6e9e272b63ff54d5138efe910cc7aac413221cb3634ea176866')],
  xudtTypeArgs: '0x4c1ecf2f14edae73b76ccf115ecfa40ba68ee315c96bd4fcfd771c2fb4c69e8f',
  receivers: [
    {
      toBtcAddress: 'tb1qvt7p9g6mw70sealdewtfp0sekquxuru6j3gwmt',
      transferAmount: BigInt(1000) * BigInt(10 ** RGBPP_TOKEN_INFO.decimal),
    },
  ],
});
