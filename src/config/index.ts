interface Config {
  apiUrl: string;
}

export const config: Config = {
  get apiUrl() {
    return localStorage.getItem("serverUrl") || import.meta.env.VITE_API_URL;
  },
};
