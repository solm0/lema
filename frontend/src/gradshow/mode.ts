import type { User } from "../types";

export const GRADSHOW_MODE = import.meta.env.VITE_APP_VARIANT === "gradshow";

export const GRADSHOW_USER: User = {
  id: 1,
  email: "solmi-@kookmin.ac.kr",
  name: "Exhibition",
};

export const GRADSHOW_PAGE_ID = "6be94e2c-e637-4586-bcf8-c03fb6c90476";

