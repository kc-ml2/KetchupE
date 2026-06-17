import { UserPayload } from "./AuthContext.types";

export interface ExtendedRequestInit extends RequestInit {
	attachDeviceId?: boolean;
	stream?: boolean;
	suppressAuthRedirect?: boolean;
  }

export interface FetchClientArgs {
	getAccessToken: () => string | null;
	setAccessToken: (token: string) => void;
	silentRefresh: () => Promise<void>;
	logout: () => void;
	getTokenPayload: (token?: string) => UserPayload | null;
	getUser: () => UserPayload | null;
	setUser: (user: UserPayload | null) => void;
}

export interface FetchClientAPI {
	get: <T = unknown>(url: string, params?: Record<string, string | number>) => Promise<T>;
	post: <T = unknown>(url: string, body?: Record<string, unknown>, config?: ExtendedRequestInit) => Promise<T>;
	patch: <T = unknown>(url: string, body?: Record<string, unknown>, config?: ExtendedRequestInit) => Promise<T>;
	postFormData: <T = unknown>(url: string, formData: FormData, config?: ExtendedRequestInit) => Promise<T>;
	postStream: <T = unknown>(url: string, body?: Record<string, unknown>, config?: ExtendedRequestInit) => Promise<T>;
	del: <T = void>(url: string, params?: Record<string, string | number>) => Promise<T>;
}


