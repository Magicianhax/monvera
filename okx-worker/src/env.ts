export interface Env {
  KV: KVNamespace;
  OKX_API_KEY: string;
  OKX_SECRET_KEY: string;
  OKX_PASSPHRASE: string;
  VENICE_API_KEY?: string;
  VIRTUALS_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AGENT_SIGNER_PRIVATE_KEY: string;
  RECORD_COMMITTER_PRIVATE_KEY: string;
  PAY_TO_ADDRESS: string;
  VERA_RECORD_V2_ADDRESS?: string;
}
