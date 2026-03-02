export type ToastSeverity = "success" | "error" | "info" | "warning";

type ToastDetail = {
  message: string;
  severity: ToastSeverity;
};

const toastTarget = new EventTarget();

const emitToast = (detail: ToastDetail) => {
  toastTarget.dispatchEvent(new CustomEvent<ToastDetail>("app-toast", { detail }));
};

export const toast = {
  success: (message: string) => emitToast({ message, severity: "success" }),
  error: (message: string) => emitToast({ message, severity: "error" }),
  info: (message: string) => emitToast({ message, severity: "info" }),
  warning: (message: string) => emitToast({ message, severity: "warning" }),
};

export const subscribeToToasts = (handler: (detail: ToastDetail) => void) => {
  const listener = (event: Event) => {
    handler((event as CustomEvent<ToastDetail>).detail);
  };

  toastTarget.addEventListener("app-toast", listener);
  return () => toastTarget.removeEventListener("app-toast", listener);
};
