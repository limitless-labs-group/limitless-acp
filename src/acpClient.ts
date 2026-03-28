import axios from "axios";
import dotenv from "dotenv";
import { loadApiKey, loadBuilderCode } from "./acpConfig.js";

dotenv.config();

loadApiKey();
loadBuilderCode();

const acpClient = axios.create({
  baseURL: process.env.ACP_API_URL || "https://claw-api.virtuals.io",
  headers: {
    "x-api-key": process.env.LITE_AGENT_API_KEY,
    "x-builder-code": process.env.ACP_BUILDER_CODE,
  },
});

acpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      throw new Error(JSON.stringify(error.response.data));
    }
    throw error;
  },
);

export default acpClient;
