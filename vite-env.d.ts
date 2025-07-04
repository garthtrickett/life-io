declare module "*?inline" {
  const content: string;
  export default content;
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

interface ImportMetaEnv {
  readonly VITE_SILENT_CLIENT_LOGGING: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
