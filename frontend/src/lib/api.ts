export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "RiverPokerLab");
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (response.status === 401 && !url.includes("/auth/"))
    window.dispatchEvent(new Event("river-auth-expired"));
  return response;
}
