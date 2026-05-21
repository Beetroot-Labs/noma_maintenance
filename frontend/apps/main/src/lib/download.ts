import { toast } from "@/lib/toast";

type DownloadUrlResponse = {
  download_url?: string;
};

const readApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore malformed payloads.
  }

  return fallback;
};

const triggerBackgroundDownload = (downloadUrl: string) => {
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const downloadFromApi = async (url: string, fallbackErrorMessage: string) => {
  try {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, fallbackErrorMessage));
    }

    const payload = (await response.json()) as DownloadUrlResponse;
    if (!payload.download_url) {
      throw new Error(fallbackErrorMessage);
    }

    triggerBackgroundDownload(payload.download_url);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : fallbackErrorMessage);
  }
};
