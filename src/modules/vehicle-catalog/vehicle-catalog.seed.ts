export type VehicleCatalogSeedConfiguration = {
  sourceKey: string;
  variant: string;
  fuel: string;
  gearboxCode: string;
  engineName: string | null;
  displacementCc: number | null;
};

export type VehicleCatalogSeedModel = {
  sourceKey: string;
  name: string;
  bodyStyle: string;
  configurations: VehicleCatalogSeedConfiguration[];
};

export type VehicleCatalogSeed = {
  meta: {
    market: string;
    asOf: string;
    attribution: string;
  };
  makes: Array<{
    sourceKey: string;
    name: string;
    models: VehicleCatalogSeedModel[];
  }>;
};
