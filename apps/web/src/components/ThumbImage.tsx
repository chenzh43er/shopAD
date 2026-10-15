import { useState, type CSSProperties } from "react";
import { Image } from "antd";
import { thumbUrlFor } from "../lib/thumbUrl";

interface ThumbImageProps {
  src: string;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
  /** 预览遮罩文字，不传则用默认点击预览 */
  previewMask?: string;
}

/** 后台列表缩略图：先拉 R2 小图，缺失时回退原图；点击预览看原图 */
export function ThumbImage({ src, width, height, className, style, previewMask }: ThumbImageProps) {
  const [useOriginal, setUseOriginal] = useState(false);
  const thumb = !useOriginal ? (thumbUrlFor(src) ?? src) : src;
  return (
    <Image
      src={thumb}
      preview={previewMask ? { src, mask: previewMask } : { src }}
      width={width}
      height={height}
      className={className}
      style={style}
      loading="lazy"
      onError={() => {
        if (!useOriginal) setUseOriginal(true);
      }}
    />
  );
}
