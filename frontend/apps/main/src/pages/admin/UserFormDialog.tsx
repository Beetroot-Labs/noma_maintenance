import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

export type UserFormValues = {
  full_name: string;
  email: string;
  phone_number: string | null;
  role: string;
};

type UserFormSubmitResult =
  | { ok: true }
  | { ok: false; error?: string; emailError?: string };

type UserFormDialogProps = {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  initialValues: UserFormValues;
  emailDisabled?: boolean;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => Promise<UserFormSubmitResult>;
};

export function UserFormDialog({
  open,
  title,
  description,
  submitLabel,
  initialValues,
  emailDisabled = false,
  onClose,
  onSubmit,
}: UserFormDialogProps) {
  const [name, setName] = useState(initialValues.full_name);
  const [email, setEmail] = useState(initialValues.email);
  const [phone, setPhone] = useState(initialValues.phone_number ?? "");
  const [role, setRole] = useState(initialValues.role);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(initialValues.full_name);
    setEmail(initialValues.email);
    setPhone(initialValues.phone_number ?? "");
    setRole(initialValues.role);
    setSubmitError(null);
    setEmailError(null);
    setIsSubmitting(false);
  }, [initialValues, open]);

  const handleRoleChange = (event: SelectChangeEvent<string>) => {
    setRole(event.target.value);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    setEmailError(null);

    const result = await onSubmit({
      full_name: name.trim(),
      email: email.trim(),
      phone_number: phone.trim() || null,
      role,
    });

    if (result.ok) {
      onClose();
      return;
    }

    setSubmitError(result.error ?? null);
    setEmailError(result.emailError ?? null);
    setIsSubmitting(false);
  };

  return (
    <Dialog
      open={open}
      onClose={isSubmitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { borderRadius: 4 } }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
          <TextField label="Név" value={name} onChange={(event) => setName(event.target.value)} fullWidth />
          <TextField
            label="E-mail"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError(null);
            }}
            disabled={emailDisabled}
            error={Boolean(emailError)}
            helperText={emailError ?? " "}
            fullWidth
          />
          <TextField
            label="Telefon"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            helperText="Opcionális"
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel id="user-role-label">Szerepkör</InputLabel>
            <Select labelId="user-role-label" value={role} label="Szerepkör" onChange={handleRoleChange}>
              <MenuItem value="admin">Adminisztrátor</MenuItem>
              <MenuItem value="lead_technician">Vezető technikus</MenuItem>
              <MenuItem value="technician">Technikus</MenuItem>
              <MenuItem value="viewer">Megtekintő</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Mégse
        </Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={isSubmitting || !name.trim() || !email.trim()}>
          {isSubmitting ? `${submitLabel}...` : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
