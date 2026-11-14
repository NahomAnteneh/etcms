import ky from 'ky';
import type { components } from './schema';

export type ProblemDetails = components['schemas']['ProblemDetails'];

export class ApiProblemError extends Error {
  public problem: ProblemDetails;
  public status: number;

  constructor(problem: ProblemDetails) {
    super(problem.detail || problem.title);
    this.name = 'ApiProblemError';
    this.problem = problem;
    this.status = problem.status;
  }
}

// Anti-ITAM client-side validator (Nielsen Heuristic #5: Error Prevention)
const FORBIDDEN_ITAM_FIELDS = ['cost', 'purchase_cost', 'license_count', 'warranty_end', 'vendor'];

export function checkPayloadForITAM(payload: unknown): string[] {
  const violations: string[] = [];
  function recurse(obj: unknown, path = '') {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => recurse(item, `${path}[${idx}]`));
      return;
    }
    for (const [key, val] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_ITAM_FIELDS.includes(lowerKey)) {
        violations.push(path ? `${path}.${key}` : key);
      }
      recurse(val, path ? `${path}.${key}` : key);
    }
  }
  recurse(payload);
  return violations;
}

// Actor credentials storage for Dev Auth and Bearer tokens
let currentDevUserId: string | null = '11111111-1111-1111-1111-111111111111'; // default platform admin for dev
let currentBearerToken: string | null = null;
let currentIntakeToken: string | null = null;

export function setDevUserId(userId: string | null) {
  currentDevUserId = userId;
}

export function getDevUserId(): string | null {
  return currentDevUserId;
}

export function setBearerToken(token: string | null) {
  currentBearerToken = token;
}

export function setIntakeToken(token: string | null) {
  currentIntakeToken = token;
}

export const api = ky.create({
  prefixUrl: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  hooks: {
    beforeRequest: [
      (request, options) => {
        // Enforce Anti-ITAM client check on mutating methods
        if (['POST', 'PUT', 'PATCH'].includes(request.method.toUpperCase()) && options.body) {
          try {
            if (typeof options.body === 'string') {
              const parsed = JSON.parse(options.body);
              const itamViolations = checkPayloadForITAM(parsed);
              if (itamViolations.length > 0) {
                throw new ApiProblemError({
                  status: 422,
                  title: 'Unprocessable Entity (Anti-ITAM Violation)',
                  detail: `Payload contains unapproved ITAM fields: ${itamViolations.join(', ')}. ETCMS is strictly an operational CMDB and prohibits asset management attributes.`,
                  type: 'https://tools.ietf.org/html/rfc9457',
                });
              }
            }
          } catch (e) {
            if (e instanceof ApiProblemError) throw e;
          }
        }

        // Inject Auth credentials
        if (currentDevUserId) {
          request.headers.set('X-Dev-User-ID', currentDevUserId);
        } else if (currentBearerToken) {
          request.headers.set('Authorization', `Bearer ${currentBearerToken}`);
        }

        if (currentIntakeToken) {
          request.headers.set('X-Intake-Token', currentIntakeToken);
        }
      },
    ],
    afterResponse: [
      async (_request, _options, response) => {
        if (!response.ok && response.headers.get('content-type')?.includes('application/problem+json')) {
          try {
            const problem = (await response.json()) as ProblemDetails;
            throw new ApiProblemError(problem);
          } catch (e) {
            if (e instanceof ApiProblemError) throw e;
          }
        }
      },
    ],
  },
});
