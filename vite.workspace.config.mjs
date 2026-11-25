// Local integration only: preserve existing local Vite configuration.
import {defineConfig, loadConfigFromFile, mergeConfig} from 'vite';
export default defineConfig(async env=>{
 const loaded=await loadConfigFromFile(env,undefined,process.cwd());
 if(!loaded)throw new Error('Existing vite.config file not found. Do not discard local proof configuration.');
 const config=mergeConfig(loaded.config,{server:{host:'127.0.0.1',port:5173,strictPort:true}});
 // Specific route first, before any existing broad /api proxy.
 const existing=config.server.proxy||{};
 const route='^/api/preprod/clearance(?:\\?|$)';
 const {[route]:unused,...rest}=existing;
 config.server.proxy={[route]:{target:'http://127.0.0.1:4176',changeOrigin:false},...rest};
 return config;
});
