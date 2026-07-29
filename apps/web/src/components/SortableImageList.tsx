import { useRef, useState, type DragEvent } from "react";
import { Button, Image, Space, Upload } from "antd";
import {
  DeleteOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";

type Props = {
  urls: string[];
  onChange: (urls: string[]) => void;
  max: number;
  uploading?: boolean;
  onUpload: (file: File) => void;
  uploadLabel?: string;
  itemSize?: number;
};

function moveItem(list: string[], from: number, to: number): string[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function SortableImageList({
  urls,
  onChange,
  max,
  uploading = false,
  onUpload,
  uploadLabel = "上传",
  itemSize = 96,
}: Props) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);

  const onDragStart = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    dragFrom.current = index;
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const onDragOver = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overIndex !== index) setOverIndex(index);
  };

  const onDrop = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const from =
      dragFrom.current ??
      Number.parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (Number.isFinite(from)) {
      onChange(moveItem(urls, from, index));
    }
    dragFrom.current = null;
    setDraggingIndex(null);
    setOverIndex(null);
  };

  const onDragEnd = () => {
    dragFrom.current = null;
    setDraggingIndex(null);
    setOverIndex(null);
  };

  return (
    <Space wrap size={12} align="start">
      {urls.map((url, index) => {
        const isDragging = draggingIndex === index;
        const isOver = overIndex === index && draggingIndex !== index;
        return (
          <div
            key={`${url}-${index}`}
            draggable
            onDragStart={onDragStart(index)}
            onDragOver={onDragOver(index)}
            onDrop={onDrop(index)}
            onDragEnd={onDragEnd}
            title="拖动调整顺序"
            style={{
              position: "relative",
              width: itemSize,
              border: isOver
                ? "1.5px solid #1677ff"
                : "1px solid #f0f0f0",
              borderRadius: 8,
              overflow: "hidden",
              background: "#fff",
              cursor: "grab",
              opacity: isDragging ? 0.45 : 1,
              boxShadow: isOver ? "0 0 0 2px rgba(22,119,255,0.15)" : undefined,
              userSelect: "none",
            }}
          >
            <div
              style={{
                width: itemSize,
                height: itemSize,
                overflow: "hidden",
              }}
            >
              <Image
                src={url}
                width={itemSize}
                height={itemSize}
                style={{ objectFit: "cover" }}
                preview={{ mask: "预览" }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                top: 4,
                left: 4,
                padding: "0 6px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontSize: 11,
                lineHeight: "18px",
                fontWeight: 600,
              }}
            >
              {index + 1}
            </div>
            <Button
              size="small"
              danger
              type="primary"
              icon={<DeleteOutlined />}
              style={{ position: "absolute", top: 4, right: 4 }}
              onClick={(e) => {
                e.stopPropagation();
                onChange(urls.filter((_, i) => i !== index));
              }}
            />
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: 4,
                background: "#fafafa",
                borderTop: "1px solid #f0f0f0",
              }}
            >
              <Button
                size="small"
                icon={<LeftOutlined />}
                disabled={index === 0}
                style={{ flex: 1 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(moveItem(urls, index, index - 1));
                }}
                aria-label="前移"
              />
              <Button
                size="small"
                icon={<RightOutlined />}
                disabled={index === urls.length - 1}
                style={{ flex: 1 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(moveItem(urls, index, index + 1));
                }}
                aria-label="后移"
              />
            </div>
          </div>
        );
      })}
      {urls.length < max ? (
        <Upload
          accept="image/jpeg,image/png,image/webp,image/gif"
          showUploadList={false}
          beforeUpload={(file) => {
            onUpload(file);
            return false;
          }}
        >
          <Button
            style={{ width: itemSize, height: itemSize + 30 }}
            icon={<PlusOutlined />}
            loading={uploading}
          >
            {uploadLabel}
          </Button>
        </Upload>
      ) : null}
    </Space>
  );
}
