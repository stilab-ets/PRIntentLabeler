export class LlmProviderRequestError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    detail?: string,
  ) {
    const safeDetail = detail?.replace(/\s+/g, " ").trim().slice(0, 240);
    super(
      `${provider} a rejeté la requête (${status})${safeDetail ? ` : ${safeDetail}` : ""}`,
    );
    this.name = "LlmProviderRequestError";
  }
}
