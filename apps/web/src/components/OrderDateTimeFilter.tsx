import { useEffect, useState } from "react";
import { DatePicker, TimePicker, Typography } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";

const { RangePicker } = DatePicker;
const { Text } = Typography;

/** 固定到整分 */
function atHm(base: Dayjs, hour: number, minute: number): Dayjs {
  return base.hour(hour).minute(minute).second(0).millisecond(0);
}

const DEFAULT_TIME_FROM = () => atHm(dayjs(), 0, 0);
const DEFAULT_TIME_TO = () => atHm(dayjs(), 23, 59);

const DATE_PRESETS: {
  label: string;
  value: () => [Dayjs, Dayjs];
}[] = [
  {
    label: "今日",
    value: () => [dayjs().startOf("day"), dayjs().startOf("day")],
  },
  {
    label: "昨日",
    value: () => {
      const d = dayjs().subtract(1, "day").startOf("day");
      return [d, d];
    },
  },
  {
    label: "近七天",
    value: () => [
      dayjs().subtract(6, "day").startOf("day"),
      dayjs().startOf("day"),
    ],
  },
  {
    label: "本月",
    value: () => [dayjs().startOf("month"), dayjs().startOf("day")],
  },
  {
    label: "近三个月",
    value: () => [
      dayjs().subtract(3, "month").startOf("day"),
      dayjs().startOf("day"),
    ],
  },
];

const TIME_QUICK: Array<{ label: string; hour: number; minute: number }> = [
  { label: "00:00", hour: 0, minute: 0 },
  { label: "08:00", hour: 8, minute: 0 },
  { label: "12:00", hour: 12, minute: 0 },
  { label: "18:00", hour: 18, minute: 0 },
  { label: "23:59", hour: 23, minute: 59 },
];

function composeRange(
  dates: [Dayjs, Dayjs] | null,
  timeFrom: Dayjs,
  timeTo: Dayjs,
): [Dayjs, Dayjs] | null {
  if (!dates?.[0] || !dates?.[1]) return null;
  return [
    atHm(dates[0], timeFrom.hour(), timeFrom.minute()),
    atHm(dates[1], timeTo.hour(), timeTo.minute()),
  ];
}

type Props = {
  value: [Dayjs, Dayjs] | null;
  onChange: (next: [Dayjs, Dayjs] | null) => void;
};

/**
 * 订单筛选：日期与时分拆开，避免日历+时分挤在同一面板。
 * - 左侧：只选日期（含快捷区间）
 * - 右侧：开始/结束时分，默认 00:00 ~ 23:59；可滚动微调，也可点常用时分
 */
export function OrderDateTimeFilter({ value, onChange }: Props) {
  const [timeFrom, setTimeFrom] = useState<Dayjs>(DEFAULT_TIME_FROM);
  const [timeTo, setTimeTo] = useState<Dayjs>(DEFAULT_TIME_TO);
  const [activeSide, setActiveSide] = useState<"from" | "to">("from");

  useEffect(() => {
    if (!value) return;
    setTimeFrom(atHm(dayjs(), value[0].hour(), value[0].minute()));
    setTimeTo(atHm(dayjs(), value[1].hour(), value[1].minute()));
  }, [value]);

  const dateValue: [Dayjs, Dayjs] | null = value
    ? [value[0].startOf("day"), value[1].startOf("day")]
    : null;

  const apply = (dates: [Dayjs, Dayjs] | null, from: Dayjs, to: Dayjs) => {
    onChange(composeRange(dates, from, to));
  };

  const onDatesChange = (dates: [Dayjs, Dayjs] | null) => {
    if (!dates?.[0] || !dates?.[1]) {
      onChange(null);
      setTimeFrom(DEFAULT_TIME_FROM());
      setTimeTo(DEFAULT_TIME_TO());
      setActiveSide("from");
      return;
    }
    apply(
      [dates[0].startOf("day"), dates[1].startOf("day")],
      timeFrom,
      timeTo,
    );
  };

  const onTimeFromChange = (t: Dayjs | null) => {
    const next = t ? atHm(t, t.hour(), t.minute()) : DEFAULT_TIME_FROM();
    setTimeFrom(next);
    if (dateValue) apply(dateValue, next, timeTo);
  };

  const onTimeToChange = (t: Dayjs | null) => {
    const next = t ? atHm(t, t.hour(), t.minute()) : DEFAULT_TIME_TO();
    setTimeTo(next);
    if (dateValue) apply(dateValue, timeFrom, next);
  };

  const pickQuick = (hour: number, minute: number) => {
    const next = atHm(dayjs(), hour, minute);
    if (activeSide === "from") {
      onTimeFromChange(next);
      setActiveSide("to");
    } else {
      onTimeToChange(next);
    }
  };

  const activeTime = activeSide === "from" ? timeFrom : timeTo;
  const timePickerProps = {
    format: "HH:mm" as const,
    allowClear: false,
    changeOnScroll: true,
    needConfirm: false,
    showNow: false,
    inputReadOnly: true,
    style: { width: 92 },
  };

  return (
    <div className="order-datetime-filter">
      <RangePicker
        value={dateValue}
        allowClear
        format="YYYY-MM-DD"
        presets={DATE_PRESETS}
        onChange={(dates) => {
          if (dates?.[0] && dates?.[1]) {
            onDatesChange([dates[0], dates[1]]);
          } else {
            onDatesChange(null);
          }
        }}
        style={{ width: 248 }}
        placeholder={["开始日期", "结束日期"]}
      />

      <div className="order-datetime-filter__times">
        <Text type="secondary" className="order-datetime-filter__label">
          时分
        </Text>
        <TimePicker
          {...timePickerProps}
          className={
            activeSide === "from"
              ? "order-time-picker order-time-picker--active"
              : "order-time-picker"
          }
          value={timeFrom}
          onChange={onTimeFromChange}
          onOpenChange={(open) => {
            if (open) setActiveSide("from");
          }}
          onFocus={() => setActiveSide("from")}
          placeholder="开始"
        />
        <Text type="secondary" className="order-datetime-filter__sep">
          ~
        </Text>
        <TimePicker
          {...timePickerProps}
          className={
            activeSide === "to"
              ? "order-time-picker order-time-picker--active"
              : "order-time-picker"
          }
          value={timeTo}
          onChange={onTimeToChange}
          onOpenChange={(open) => {
            if (open) setActiveSide("to");
          }}
          onFocus={() => setActiveSide("to")}
          placeholder="结束"
        />
      </div>

      <div className="order-time-quick" role="group" aria-label="常用时分">
        <Text type="secondary" className="order-time-quick__hint">
          {activeSide === "from" ? "开始" : "结束"}
        </Text>
        {TIME_QUICK.map((item) => {
          const selected = activeTime.format("HH:mm") === item.label;
          return (
            <button
              key={item.label}
              type="button"
              title={`设为${activeSide === "from" ? "开始" : "结束"} ${item.label}`}
              className={
                selected
                  ? "order-time-quick__btn order-time-quick__btn--active"
                  : "order-time-quick__btn"
              }
              onClick={() => pickQuick(item.hour, item.minute)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
