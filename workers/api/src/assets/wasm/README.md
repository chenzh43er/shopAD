# jsquash WASM codecs

Bundled for Cloudflare Workers (no dynamic WASM fetch).

Source packages: `@jsquash/jpeg`, `@jsquash/png`, `@jsquash/webp`, `@jsquash/resize`.

After upgrading those packages, re-copy:

```powershell
Copy-Item node_modules\@jsquash\jpeg\codec\dec\mozjpeg_dec.wasm src\assets\wasm\
Copy-Item node_modules\@jsquash\png\codec\pkg\squoosh_png_bg.wasm src\assets\wasm\
Copy-Item node_modules\@jsquash\webp\codec\dec\webp_dec.wasm src\assets\wasm\
Copy-Item node_modules\@jsquash\webp\codec\enc\webp_enc_simd.wasm src\assets\wasm\
Copy-Item node_modules\@jsquash\resize\lib\resize\pkg\squoosh_resize_bg.wasm src\assets\wasm\
```
