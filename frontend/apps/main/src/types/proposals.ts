export type AdminBuilding = {
  id: string;
  name: string;
  address: string;
};

export type AdminProposalDeviceRow = {
  device_id: string;
  barcode: string | null;
  building_name: string;
  location_description: string | null;
  wing: string | null;
  floor: string | null;
  room: string | null;
  kind: string;
  original_kind: string | null;
  brand: string | null;
  model: string | null;
  source_device_code: string | null;
  latest_maintenance_at: string | null;
};

export type AdminProposalListRow = {
  proposal_id: string;
  created_at: string;
  created_by_name: string | null;
  external_issue_number: string | null;
  device_id: string;
  device_barcode: string | null;
  device_source_device_code: string | null;
  device_kind: string;
  device_original_kind: string | null;
  device_brand: string | null;
  device_model: string | null;
  building_name: string;
  building_address: string;
  location_description: string | null;
  wing: string | null;
  floor: string | null;
  room: string | null;
  net_price: string;
  currency: string;
  line_count: number;
  url: string | null;
};

export type AdminProposalLineRow = {
  proposal_line_id: string;
  position: number;
  item: string;
  quantity: string;
  uom: string;
  net_unit_price: string;
  line_total: string;
};

export type AdminProposalVersionRow = {
  version_number: number;
  created_at: string;
  created_by_name: string | null;
  net_price: string;
  currency: string;
  url: string | null;
};

export type AdminProposalDetailPayload = AdminProposalListRow & {
  created_by_email: string | null;
  building_id: string;
  note: string;
  external_issue_number: string | null;
  versions: AdminProposalVersionRow[];
  lines: AdminProposalLineRow[];
};

export type ProposalLineDraft = {
  id: string;
  item: string;
  quantity: string;
  uom: string;
  net_unit_price: string;
};

export type CreateAdminProposalLineInput = {
  item: string;
  quantity: string;
  uom: string;
  net_unit_price: string;
};

export type CreateAdminProposalRequest = {
  device_id: string;
  note: string;
  external_issue_number: string;
  lines: CreateAdminProposalLineInput[];
};

export type UpdateAdminProposalRequest = CreateAdminProposalRequest;
