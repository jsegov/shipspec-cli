import { config as loadDotenv } from "dotenv";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { ShipSpecConfigSchema, type ShipSpecConfig } from "./schema.js";

const CONFIG_FILES = ["shipspec.json", ".shipspecrc", ".shipspecrc.json"];

export async function loadConfig(
  cwd: string = process.cwd(),
  overrides: Partial<ShipSpecConfig> = {}
): Promise<ShipSpecConfig> {
  loadDotenv({ path: join(cwd, ".env") });

  let fileConfig: Partial<ShipSpecConfig> = {};
  for (const filename of CONFIG_FILES) {
    const filepath = join(cwd, filename);
    if (existsSync(filepath)) {
      try {
        const content = await readFile(filepath, "utf-8");
        fileConfig = JSON.parse(content);
        break;
      } catch (error) {
        // Silently skip malformed config files
      }
    }
  }

  const envConfig = {
    llm: {
      apiKey: process.env.OPENAI_API_KEY 
           || process.env.ANTHROPIC_API_KEY 
           || process.env.MISTRAL_API_KEY 
           || process.env.GOOGLE_API_KEY,
    },
  };

  const merged = deepMerge(fileConfig, envConfig, overrides);
  return ShipSpecConfigSchema.parse(merged);
}

function deepMerge(prev: any, ...objects: any[]): any {
  const isObject = (obj: any) => obj && typeof obj === 'object' && !Array.isArray(obj);

  return objects.reduce((acc, obj) => {
    Object.keys(obj).forEach(key => {
      const pVal = acc[key];
      const oVal = obj[key];

      if (isObject(pVal) && isObject(oVal)) {
        acc[key] = deepMerge(pVal, oVal);
      } else if (oVal !== undefined) {
        acc[key] = oVal;
      }
    });
    return acc;
  }, prev);
}
