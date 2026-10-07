import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.solmi.lema",
  appName: "Lema",
  webDir: "dist",
  android: {
    flavor: "standard",
  },
};

export default config;
