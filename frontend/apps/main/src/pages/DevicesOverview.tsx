import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { getCachedBuildingSnapshot } from "@noma/shared";
import { Layout } from "@/components/Layout";
import { useMaintenance } from "@/context/MaintenanceContext";
import { useDemoUser } from "@/context/DemoUserContext";
import { getDeviceKindLabel } from "@/lib/deviceKind";
import { formatDateTime } from "@/lib/date";
import { appColors } from "@/theme";

type DeviceRow = {
  id: string;
  address: string;
  location: string;
  model: string;
  kind: string;
  lastMaintenance?: Date;
  lastMaintenanceMalfunction?: boolean;
};

export default function DevicesOverview() {
  const { todaysWorks, pastWorks } = useMaintenance();
  const { user } = useDemoUser();
  const navigate = useNavigate();
  const [filterText, setFilterText] = useState("");
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  const isFuzzyMatch = (query: string, value: string) => {
    if (!query) return true;
    const normalizedQuery = normalize(query);
    const normalizedValue = normalize(value);
    if (!normalizedQuery) return true;
    if (normalizedValue.includes(normalizedQuery)) return true;
    let queryIndex = 0;
    for (let i = 0; i < normalizedValue.length && queryIndex < normalizedQuery.length; i += 1) {
      if (normalizedValue[i] === normalizedQuery[queryIndex]) {
        queryIndex += 1;
      }
    }
    return queryIndex === normalizedQuery.length;
  };

  useEffect(() => {
    let cancelled = false;

    const composeLocation = (
      floor: string | null,
      wing: string | null,
      room: string | null,
      description: string | null,
    ) => {
      const primary = [floor, wing, room].map((part) => part?.trim()).filter(Boolean).join(", ");
      const secondary = description?.trim();
      if (primary && secondary) {
        return `${primary} (${secondary})`;
      }
      if (primary) {
        return primary;
      }
      if (secondary) {
        return secondary;
      }
      return "Ismeretlen helyszín";
    };

    const loadDevices = async () => {
      if (!user?.tenantId) {
        if (!cancelled) {
          setDevices([]);
        }
        return;
      }

      try {
        const currentShiftResponse = await fetch("/api/shifts/current", {
          credentials: "include",
          cache: "no-store",
        });
        if (!currentShiftResponse.ok) {
          if (!cancelled) {
            setDevices([]);
          }
          return;
        }
        const currentShiftPayload = (await currentShiftResponse.json()) as {
          shift: { id: string } | null;
        };
        const shiftId = currentShiftPayload.shift?.id;
        if (!shiftId) {
          if (!cancelled) {
            setDevices([]);
          }
          return;
        }

        const waitingRoomResponse = await fetch(`/api/shifts/${shiftId}/waiting-room`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!waitingRoomResponse.ok) {
          if (!cancelled) {
            setDevices([]);
          }
          return;
        }
        const waitingRoomPayload = (await waitingRoomResponse.json()) as { building_id: string };
        const snapshot = await getCachedBuildingSnapshot(user.tenantId, waitingRoomPayload.building_id);
        if (!snapshot) {
          if (!cancelled) {
            setDevices([]);
          }
          return;
        }

        const locationById = new Map(
          snapshot.locations.map((location) => [
            location.id,
            composeLocation(
              location.floor,
              location.wing,
              location.room,
              location.location_description,
            ),
          ]),
        );

        const lastMaintenanceById = new Map<string, { timestamp: Date; isMalfunctioning: boolean }>();
        const allWorks = [...todaysWorks, ...pastWorks];
        allWorks.forEach((work) => {
          const timestamp = work.endTime ?? work.startTime;
          const existing = lastMaintenanceById.get(work.hvacId);
          if (!existing || timestamp.getTime() > existing.timestamp.getTime()) {
            lastMaintenanceById.set(work.hvacId, {
              timestamp,
              isMalfunctioning: work.isMalfunctioning,
            });
          }
        });

        const rows = snapshot.devices
          .filter((device) => Boolean(device.code?.trim()))
          .map((device) => {
            const code = device.code?.trim() ?? "";
            return {
              id: code,
              address: snapshot.building.address ?? "Ismeretlen cím",
              location: (device.location_id ? locationById.get(device.location_id) : null) || "Ismeretlen helyszín",
              model: device.model?.trim() || "Ismeretlen modell",
              kind:
                getDeviceKindLabel(device.kind as Parameters<typeof getDeviceKindLabel>[0]) ??
                device.kind,
              lastMaintenance: lastMaintenanceById.get(code)?.timestamp,
              lastMaintenanceMalfunction: lastMaintenanceById.get(code)?.isMalfunctioning ?? false,
            } satisfies DeviceRow;
          })
          .sort((a, b) => a.id.localeCompare(b.id, "hu-HU"));

        if (!cancelled) {
          setDevices(rows);
        }
      } catch {
        if (!cancelled) {
          setDevices([]);
        }
      }
    };

    void loadDevices();
    return () => {
      cancelled = true;
    };
  }, [pastWorks, todaysWorks, user?.tenantId]);

  const filteredDevices = useMemo(() => {
    const query = filterText.trim();
    if (!query) {
      return devices;
    }
    return devices.filter((device) => {
      const haystack = [
        device.id,
        device.address,
        device.location,
        device.model,
        device.kind,
      ].join(" ");
      return isFuzzyMatch(query, haystack);
    });
  }, [devices, filterText]);

  return (
    <Layout>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3, animation: "slideUp 0.3s ease-out" }}>
        <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Eszközök áttekintése
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {filteredDevices.length} / {devices.length} eszköz
          </Typography>
        </Box>

        <Card sx={{ boxShadow: "0 10px 24px rgba(31, 50, 58, 0.12)" }}>
          <CardContent sx={{ p: 2, pb: 0 }}>
            <TextField
              fullWidth
              size="small"
              label="Keresés"
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder="Szűrés az összes oszlopban"
            />
          </CardContent>
          <CardContent sx={{ p: 0 }}>
            <TableContainer>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: "rgba(31, 50, 58, 0.04)" }}>
                    <TableCell sx={{ fontWeight: 700, color: appColors.mutedForeground }}>Azonosító</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: appColors.mutedForeground }}>Cím</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: appColors.mutedForeground }}>Helyszín</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: appColors.mutedForeground }}>Modell</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: appColors.mutedForeground }}>Típus</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: appColors.mutedForeground }}>
                      Utolsó karbantartás
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredDevices.map((device) => (
                    <TableRow
                      key={device.id}
                      hover
                      onClick={() => navigate(`/devices/${device.id}`)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell sx={{ fontWeight: 600 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                            {device.id}
                          </Typography>
                          {device.lastMaintenanceMalfunction && (
                            <AlertTriangle size={16} color={appColors.destructive} />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>{device.address}</TableCell>
                      <TableCell>{device.location}</TableCell>
                      <TableCell>{device.model}</TableCell>
                      <TableCell>{device.kind}</TableCell>
                      <TableCell>
                        {device.lastMaintenance ? (
                          formatDateTime(device.lastMaintenance)
                        ) : (
                          <Typography component="span" variant="body2" color="text.secondary">
                            —
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>
    </Layout>
  );
}
