const timeFormatter = new Intl.DateTimeFormat("hu-HU", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateTimeFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  month: "short",
  day: "numeric",
});

export const formatTime = (date: Date) => timeFormatter.format(date);

export const formatDateTime = (date: Date) => dateTimeFormatter.format(date);
