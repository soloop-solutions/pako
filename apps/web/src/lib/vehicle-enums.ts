export const VehicleType = { Car: 0, Van: 1, Truck: 2, Motorcycle: 3, Other: 4 } as const;
export type VehicleTypeValue = (typeof VehicleType)[keyof typeof VehicleType];

export const VehicleStatus = { Active: 0, InMaintenance: 1, OutOfService: 2 } as const;
export type VehicleStatusValue = (typeof VehicleStatus)[keyof typeof VehicleStatus];

export const VEHICLE_TYPES: Record<number, string> = {
  0: "vehicle.type.car",
  1: "vehicle.type.van",
  2: "vehicle.type.truck",
  3: "vehicle.type.motorcycle",
  4: "vehicle.type.other",
};

export const VEHICLE_STATUSES: Record<number, string> = {
  0: "vehicle.status.active",
  1: "vehicle.status.maintenance",
  2: "vehicle.status.outOfService",
};
