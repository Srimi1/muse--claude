import { META_API_BASE_URL, SUBSCRIPTION_API_BASE_URL, SUBSCRIPTION_API_HEADERS } from '../config/constants.js';
import type { ResolvedAuth } from '../config/credentials.js';

/**
 * Represents a Spark model returned from the Meta Model API.
 */
export interface SparkModel {
  id: string;
  name: string;
  created: number;
  owned_by: string;
  isContributor: boolean;
  description?: string;
}

/**
 * Client for interacting with the Meta Model API.
 */
export class MetaClient {
  private apiKey: string;
  private baseUrl: string;
  private extraHeaders: Record<string, string>;

  /**
   * Creates a new MetaClient.
   * @param apiKey The API key for authentication.
   * @param baseUrl Optional custom base URL (default: META_API_BASE_URL)
   * @param extraHeaders Headers sent with every request besides Authorization
   */
  constructor(apiKey: string, baseUrl?: string, extraHeaders: Record<string, string> = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || META_API_BASE_URL;
    this.extraHeaders = extraHeaders;
  }

  /**
   * Helper to perform fetch requests with error handling.
   */
  private async request(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...this.extraHeaders,
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      let message = `API Error ${response.status}: ${response.statusText}`;
      if (response.status === 401) message = '401 Unauthorized: Invalid API key.';
      else if (response.status === 403) message = '403 Forbidden: No access to this resource.';
      else if (response.status === 429) message = '429 Too Many Requests: Rate limit exceeded.';
      throw new Error(message);
    }
    
    return response;
  }

  /**
   * Lists available Muse Spark models.
   * Filters to models with 'muse-spark' or 'spark' in the id, excluding Image/Voice/SAM models.
   * Identifies contributor models if 'contributor' is in the id.
   * @returns A promise resolving to an array of SparkModels.
   */
  async listModels(): Promise<SparkModel[]> {
    const response = await this.request('/models');
    const data = await response.json() as any;
    
    const models: any[] = data.data || [];
    
    return models
      .filter(model => {
        const id = model.id.toLowerCase();
        const isSpark = id.includes('muse-spark') || id.includes('spark');
        const isExcluded = id.includes('image') || id.includes('voice') || id.includes('sam');
        return isSpark && !isExcluded;
      })
      .map(model => ({
        id: model.id,
        name: model.name || model.id,
        created: model.created,
        owned_by: model.owned_by,
        isContributor: model.id.toLowerCase().includes('contributor'),
        description: model.description
      }));
  }

  /**
   * Tests whether the provided credentials are valid.
   * @returns A promise resolving to true if valid, false otherwise.
   */
  async testAuth(): Promise<boolean> {
    try {
      await this.request('/models');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Tests streaming latency using the Messages API.
   * @returns A promise resolving to an object indicating success and latency.
   */
  async testStreaming(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const startTime = Date.now();
    try {
      const response = await this.request('/messages', {
        method: 'POST',
        body: JSON.stringify({
          model: 'muse-spark-1.3',
          stream: true,
          max_tokens: 50,
          messages: [{ role: 'user', content: 'Say hello' }]
        })
      });

      // Read first chunk to measure latency
      const reader = response.body?.getReader();
      if (reader) {
        await reader.read();
        reader.releaseLock();
      }
      
      const latencyMs = Date.now() - startTime;
      return { success: true, latencyMs };
    } catch (error: any) {
      return { success: false, latencyMs: -1, error: error?.message };
    }
  }
}

/**
 * Creates a MetaClient for a resolved credential, targeting the subscription
 * endpoint (with its extra headers) for OAuth tokens and the Model API for
 * API keys.
 *
 * @param auth A resolved credential with a non-null token
 * @param baseUrl Optional override for either kind (used by tests)
 */
export function createMetaClient(auth: Pick<ResolvedAuth, 'kind'> & { token: string }, baseUrl?: string): MetaClient {
  if (auth.kind === 'oauth') {
    return new MetaClient(auth.token, baseUrl ?? SUBSCRIPTION_API_BASE_URL, { ...SUBSCRIPTION_API_HEADERS });
  }
  return new MetaClient(auth.token, baseUrl);
}
