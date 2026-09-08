import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Added to ease deploying of Jeroenblog.com
  base: process.env.BASE ? `/${process.env.BASE.replace(/^\/+|\/+$/g, '')}/` : '/'
})
