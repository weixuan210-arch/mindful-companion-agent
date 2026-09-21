// Server-only helpers for the Lovable AI Gateway.
// Captures and re-sends the gateway's X-Lovable-AIG-Run-ID header.

const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export function getLovableAiGatewayRunId(request: Request): string | undefined {
  return request.headers.get(RUN_ID_HEADER) ?? undefined;
}

export function createLovableAiGatewayRunIdFetch(initialRunId?: string) {
  let runId = initialRunId;

  const wrapped: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (runId) headers.set(RUN_ID_HEADER, runId);
    const response = await fetch(input, { ...init, headers });
    const returned = response.headers.get(RUN_ID_HEADER);
    if (returned) runId = returned;
    return response;
  };

  return {
    fetch: wrapped,
    get runId() {
      return runId;
    },
  };
}

export function getLovableAiGatewayResponseHeaders(
  _unused?: unknown,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { ...extra };
}

export function withLovableAiGatewayRunIdHeader(
  response: Response,
  runIdFetch: { readonly runId: string | undefined },
): Response {
  if (runIdFetch.runId) {
    response.headers.set(RUN_ID_HEADER, runIdFetch.runId);
  }
  return response;
}
