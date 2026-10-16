// The API reaches stored tokens and live clients, so only the extension's own tests receive it.
export function exposedApi<T>(isTest: boolean, api: T): T | undefined {
  return isTest ? api : undefined;
}
