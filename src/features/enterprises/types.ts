export type Enterprise = {
  id: string;
  name: string;
  address: string;
  phone: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateEnterprisePayload = {
  name: string;
  address: string;
  phone: string;
};
