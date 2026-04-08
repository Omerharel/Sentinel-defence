import path from 'path';
import { fileURLToPath } from 'url';

/** תיקיית הפרויקט — חובה כש־`next dev` רץ עם cwd אחר (למשל Desktop), אחרת Tailwind מחפש `tailwindcss` בשורש הלא נכון. */
const projectDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': { base: projectDir },
  },
};

export default config;
