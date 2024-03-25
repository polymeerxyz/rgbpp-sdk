import { ErrorCodes, ErrorMessages, TxBuildError } from '../error';
import { isDomain } from '../utils';

export interface BtcAssetsApiRequestOptions extends RequestInit {
  params?: Record<string, any>;
  method?: 'GET' | 'POST';
  requireToken?: boolean;
}

export interface BtcAssetsApiToken {
  token: string;
}

export interface BtcAssetsApiBlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: number;
  difficulty: number;
  mediantime: number;
}

export interface BtcAssetsApiBlock {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  merkle_root: string;
  previousblockhash: string;
  mediantime: number;
  nonce: number;
  bits: number;
  difficulty: number;
}

export interface BtcAssetsApiBlockHash {
  hash: string;
}

export interface BtcAssetsApiBlockHeader {
  header: string;
}

export interface BtcAssetsApiBalanceParams {
  min_satoshi?: number;
}
export interface BtcAssetsApiBalance {
  address: string;
  satoshi: number;
  pending_satoshi: number;
  dust_satoshi: number;
  utxo_count: number;
}

export interface BtcAssetsApiUtxoParams {
  min_satoshi?: number;
}
export interface BtcAssetsApiUtxo {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
}

export interface BtcAssetsApiSentTransaction {
  txid: string;
}

export interface BtcAssetsApiTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: {
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address: string;
      value: number;
    };
    scriptsig: string;
    scriptsig_asm: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
  }[];
  vout: {
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address: string;
    value: number;
  }[];
  weight: number;
  size: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
}

export class BtcAssetsApi {
  public url: string;
  public app?: string;
  public domain?: string;
  public origin?: string;
  private token?: string;

  constructor(props: { url: string; app?: string; domain?: string; origin?: string; token?: string }) {
    this.url = props.url;

    // Optional
    this.app = props.app;
    this.domain = props.domain;
    this.origin = props.origin;
    this.token = props.token;

    // Validation
    if (this.domain && !isDomain(this.domain) && this.domain !== 'localhost') {
      throw new TxBuildError(
        ErrorCodes.ASSETS_API_INVALID_PARAM,
        `${ErrorMessages[ErrorCodes.ASSETS_API_INVALID_PARAM]}: domain`,
      );
    }
  }

  static fromToken(url: string, token: string, origin?: string) {
    return new BtcAssetsApi({ url, token, origin });
  }

  async init(force?: boolean) {
    // If the token exists and not a force action, do nothing
    if (this.token && !force) {
      return;
    }

    const token = await this.generateToken();
    this.token = token.token;
  }

  async request<T>(route: string, options?: BtcAssetsApiRequestOptions): Promise<T> {
    const { requireToken = true, method = 'GET', headers, params, ...otherOptions } = options ?? {};
    if (requireToken && !this.token && !(this.app && this.domain)) {
      throw new TxBuildError(
        ErrorCodes.ASSETS_API_INVALID_PARAM,
        `${ErrorMessages[ErrorCodes.ASSETS_API_INVALID_PARAM]}: app, domain`,
      );
    }
    if (requireToken && !this.token) {
      await this.init();
    }

    const packedParams = params ? '?' + new URLSearchParams(params).toString() : '';
    const withOriginHeaders = this.origin ? { origin: this.origin } : void 0;
    const withAuthHeaders = requireToken && this.token ? { Authorization: `Bearer ${this.token}` } : void 0;
    const res = await fetch(`${this.url}${route}${packedParams}`, {
      method,
      headers: {
        ...withOriginHeaders,
        ...withAuthHeaders,
        ...headers,
      },
      ...otherOptions,
    } as RequestInit);

    const status = res.status;

    let text: string | undefined;
    let json: Record<string, any> | undefined;
    let ok: boolean = false;
    try {
      text = await res.text();
      json = JSON.parse(text);
      ok = json?.ok ?? res.ok ?? false;
    } catch {
      // do nothing
    }

    if (!json) {
      if (status === 200) {
        throw new TxBuildError(ErrorCodes.ASSETS_API_RESPONSE_DECODE_ERROR);
      } else if (status === 401) {
        throw new TxBuildError(ErrorCodes.ASSETS_API_UNAUTHORIZED);
      } else {
        const message = text ? `(${status}): ${text}` : `${status}`;
        throw new TxBuildError(
          ErrorCodes.ASSETS_API_RESPONSE_ERROR,
          `${ErrorMessages[ErrorCodes.ASSETS_API_RESPONSE_ERROR]}${message}`,
        );
      }
    }
    if (json && !ok) {
      const innerError = json?.error?.error ? `(${json.error.error.code}) ${json.error.error.message}` : void 0;
      const message = json.message ?? innerError ?? JSON.stringify(json);
      throw new TxBuildError(
        ErrorCodes.ASSETS_API_RESPONSE_ERROR,
        `${ErrorMessages[ErrorCodes.ASSETS_API_RESPONSE_ERROR]}: ${message}`,
      );
    }

    return json! as T;
  }

  async post<T>(route: string, options?: BtcAssetsApiRequestOptions): Promise<T> {
    return this.request(route, {
      method: 'POST',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    } as BtcAssetsApiRequestOptions);
  }

  generateToken() {
    if (!this.app || !this.domain) {
      throw new TxBuildError(
        ErrorCodes.ASSETS_API_INVALID_PARAM,
        `${ErrorMessages[ErrorCodes.ASSETS_API_INVALID_PARAM]}: app, domain`,
      );
    }

    return this.post<BtcAssetsApiToken>('/token/generate', {
      requireToken: false,
      body: JSON.stringify({
        app: this.app!,
        domain: this.domain!,
      }),
    });
  }

  getBlockchainInfo() {
    return this.request<BtcAssetsApiBlockchainInfo>('/bitcoin/v1/info');
  }

  getBlockByHash(hash: string) {
    return this.request<BtcAssetsApiBlock>(`/bitcoin/v1/block/${hash}`);
  }

  getBlockHeaderByHash(hash: string) {
    return this.request<BtcAssetsApiBlockHeader>(`/bitcoin/v1/block/${hash}/header`);
  }

  getBlockHashByHeight(height: number) {
    return this.request<BtcAssetsApiBlockHash>(`/bitcoin/v1/block/height/${height}`);
  }

  getBalance(address: string, params?: BtcAssetsApiBalanceParams) {
    return this.request<BtcAssetsApiBalance>(`/bitcoin/v1/address/${address}/balance`, {
      params,
    });
  }

  getUtxos(address: string, params?: BtcAssetsApiUtxoParams) {
    return this.request<BtcAssetsApiUtxo[]>(`/bitcoin/v1/address/${address}/unspent`, {
      params,
    });
  }

  getTransactions(address: string) {
    return this.request<BtcAssetsApiTransaction[]>(`/bitcoin/v1/address/${address}/txs`);
  }

  getTransaction(txId: string) {
    return this.request<BtcAssetsApiTransaction>(`/bitcoin/v1/transaction/${txId}`);
  }

  sendTransaction(txHex: string) {
    return this.post<BtcAssetsApiSentTransaction>('/bitcoin/v1/transaction', {
      body: JSON.stringify({
        txHex,
      }),
    });
  }
}
