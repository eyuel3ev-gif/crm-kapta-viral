import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite carga su binario WebAssembly por su cuenta. Si el bundler lo
  // empaqueta, las rutas internas dejan de resolver y falla al arrancar.
  serverExternalPackages: ['@electric-sql/pglite'],
  experimental: {
    // Las transcripciones pueden ser muy largas; el límite por defecto (1 MB)
    // se queda corto en una reunión de 60 minutos.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
