import axios, { AxiosInstance, AxiosRequestConfig } from "axios";

declare module "axios" {
  export interface AxiosInstance {
    $get: <T>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  }
}

export const $http: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL, // Replace with your API base URL
  headers: {
    "Content-Type": "application/json",
  },
});

$http.$get = async <T>(url: string, config?: AxiosRequestConfig) => {
  const response = await $http.get<T>(url, config);
  return response.data;
};
