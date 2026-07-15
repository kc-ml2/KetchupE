import { config } from '@config/index';
import type { ExtendedRequestInit, FetchClientArgs, FetchClientAPI } from  '@app-types/fetchClient.types'

/**
 * 백엔드 에러 응답에서 사람이 읽을 수 있는 메시지를 추출한다.
 * `detail`은 문자열, 객체({ code, message }), 검증 에러 배열([{ loc, msg, type }]) 중 하나일 수 있다.
 */
function extractErrorMessage(errorData: unknown): string {
  if (!errorData || typeof errorData !== "object") return "";
  const { detail, message } = errorData as Record<string, unknown>;

  // 커스텀 에러: detail = { code, message }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const detailMessage = (detail as Record<string, unknown>).message;
    if (typeof detailMessage === "string") return detailMessage;
  }

  // 검증 에러: detail = [{ loc, msg, type }, ...]
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) =>
        item && typeof item === "object"
          ? (item as Record<string, unknown>).msg
          : item
      )
      .filter((msg): msg is string => typeof msg === "string");
    if (messages.length > 0) return messages.join(", ");
  }

  if (typeof detail === "string") return detail;
  if (typeof message === "string") return message;
  return "";
}

/**
 * HTTP 에러. status code를 보존해 호출부에서 분기할 수 있게 한다. (예: 409 → 폴백)
 */
export class FetchError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FetchError";
    this.status = status;
  }
}


export function createFetchClient({
  getAccessToken,
  setAccessToken,
  silentRefresh,
  logout,
  getTokenPayload,
  getUser,
  setUser,
}: FetchClientArgs): FetchClientAPI {
	const BASE_URL = config.apiUrl;
  
	const getDeviceId = () => {
	  let deviceId = localStorage.getItem("device_id");
	  if (!deviceId) {
		deviceId = `device-${crypto.randomUUID()}`;
		localStorage.setItem("device_id", deviceId);
	  }
	  return deviceId;
	};

	async function fetchWithAuth(
		url: string,
		options: ExtendedRequestInit = {},
		retrying: boolean = false
	) {
		const token = getAccessToken();

		const deviceId = getDeviceId();

		const isFormData = options.body instanceof FormData;
		const headers = {
		...(isFormData ? {} : { "Content-Type": "application/json" }),
		...(token && { Authorization: `Bearer ${token}` }),
		"device-id": deviceId,
		...options.headers,
	  };
  
	  let body = options.body;
	  const needAttachDeviceId = options.attachDeviceId === true;
  
	  if (body && typeof body === "string" && needAttachDeviceId) {
		try {
		  const parsedBody = JSON.parse(body);
		  body = JSON.stringify({ ...parsedBody, device_id: deviceId });
		} catch (e) {
		  console.error("Invalid JSON body", e);
		}
	  }
  
	  const config = {
		...options,
		headers,
		body,
		credentials: "include" as RequestCredentials,
	  };

	  try {
		const res = await fetch(`${BASE_URL}${url}`, config);
  
		// 1. X-Access-Token이 있으면 갱신 -> user 상태도 갱신
		const newAccessToken = res.headers.get("X-Access-Token");
		if (newAccessToken) {
		  setAccessToken(newAccessToken);
		  const payload = getTokenPayload(newAccessToken);
		  const prev = getUser();
		  setUser({
			email: prev?.email ?? payload?.email ?? "",
			name: payload?.name ?? prev?.name ?? null,
		  });
		}
  
		// 2. 401이면 에러 코드에 따라 처리
		if (res.status === 401 && !retrying) {
		  const errorData = await res.json().catch(() => ({}));
		  const errorCode = errorData?.detail?.code;

		  console.warn("[fetchClient] 401 detected, code:", errorCode);

		  // TOKEN_EXPIRED일 때만 refresh 시도
		  if (errorCode === "TOKEN_EXPIRED") {
			try {
			  await silentRefresh();
			  return fetchWithAuth(url, options, true); // refresh 후 1번만 재시도
			} catch (e) {
			  console.error("[fetchClient] Token refresh failed", e);
			}
		  }

		  // TOKEN_MISSING, TOKEN_INVALID, USER_NOT_FOUND 또는 refresh 실패 시
		  if (options.suppressAuthRedirect) {
			throw new Error(errorData?.detail?.message || "Session expired");
		  }
		  logout();
		  const currentLocation = window.location.protocol === "file:"
			? window.location.hash.replace(/^#/, "") || "/chatbot"
			: window.location.pathname + window.location.search;
		  const loginPath = `/login?from=${encodeURIComponent(currentLocation)}`;
		  if (window.location.protocol === "file:") {
			window.location.hash = loginPath;
		  } else {
			window.location.href = loginPath;
		  }
		  throw new Error(extractErrorMessage(errorData) || "Session expired");
		}
  
		if (!res.ok) {
		  const errorData = await res.json().catch(() => ({}));
		  throw new FetchError(res.status, extractErrorMessage(errorData) || res.statusText);
		}

		if (res.status === 204) {
			return undefined;
		}

		const data = await res.json();
		return data;
	  } catch (error) {
		console.error("[fetchClient] Error:", error);
		throw error;
	  }
	}
  
	return {
	  get: (url: string, params: Record<string, string | number> = {}) => {
		const stringParams = Object.fromEntries(
		  Object.entries(params).map(([key, value]) => [key, String(value)])
		);
		const query = new URLSearchParams(stringParams).toString();
		const fullUrl = query ? `${url}?${query}` : url;
		return fetchWithAuth(fullUrl);
	  },
	  post: (url: string, body: Record<string, unknown> = {}, config: ExtendedRequestInit = {}) =>
		fetchWithAuth(url, {
		  method: "POST",
		  body: JSON.stringify(body),
		  ...config,
		}),
	  patch: (url: string, body: Record<string, unknown> = {}, config: ExtendedRequestInit = {}) =>
		fetchWithAuth(url, {
		  method: "PATCH",
		  body: JSON.stringify(body),
		  ...config,
		}),
	  postFormData: (url: string, formData: FormData, config: ExtendedRequestInit = {}) =>
		fetchWithAuth(url, {
		  method: "POST",
		  body: formData,
		  headers: {},
		  ...config,
		}),
	  del: (url: string, params: Record<string, string | number> = {}) => {
		const stringParams = Object.fromEntries(
		  Object.entries(params).map(([key, value]) => [key, String(value)])
		);
		const query = new URLSearchParams(stringParams).toString();
		const fullUrl = query ? `${url}?${query}` : url;
		return fetchWithAuth(fullUrl, { method: "DELETE" });
	},
	};
  }
