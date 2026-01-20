import { useEffect, useState } from "react";
import { Alert, AlertColor, Snackbar } from "@mui/material";
import { appColors } from "@/theme";
import { subscribeToToasts } from "@/lib/toast";

type ToastState = {
  open: boolean;
  message: string;
  severity: AlertColor;
};

const initialState: ToastState = {
  open: false,
  message: "",
  severity: "success",
};

export function NotificationProvider() {
  const [toastState, setToastState] = useState<ToastState>(initialState);

  useEffect(() => {
    return subscribeToToasts((detail) => {
      setToastState({
        open: true,
        message: detail.message,
        severity: detail.severity,
      });
    });
  }, []);

  const handleClose = () => {
    setToastState((prev) => ({ ...prev, open: false }));
  };

  return (
    <Snackbar
      open={toastState.open}
      autoHideDuration={3500}
      onClose={handleClose}
      anchorOrigin={{ vertical: "top", horizontal: "right" }}
    >
      <Alert
        onClose={handleClose}
        severity={toastState.severity}
        variant="filled"
        sx={{
          bgcolor:
            toastState.severity === "success"
              ? appColors.success
              : toastState.severity === "error"
                ? appColors.destructive
                : toastState.severity === "warning"
                  ? appColors.warning
                  : appColors.primary,
          color:
            toastState.severity === "warning"
              ? appColors.warningForeground
              : appColors.successForeground,
        }}
      >
        {toastState.message}
      </Alert>
    </Snackbar>
  );
}
