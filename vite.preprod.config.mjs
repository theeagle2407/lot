import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({plugins:[react()],publicDir:false,build:{outDir:'dist-preprod',emptyOutDir:true,rollupOptions:{input:fileURLToPath(new URL('./lot-public.html',import.meta.url))}}});
