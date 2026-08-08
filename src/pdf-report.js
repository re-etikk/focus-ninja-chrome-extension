// src/pdf-report.js
// Builds and downloads a clean PDF summary report using the real,
// npm-installed jsPDF package (bundled locally, no CDN).
import { jsPDF } from "jspdf";

export function buildAndDownloadPdf(state) {
  const { user, settings, stats, todos } = state;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 48;
  let y = 56;

  const accent = [36, 64, 110];
  const muted = [91, 100, 120];
  const text = [23, 32, 51];

  function heading(title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...text);
    doc.text(title, marginX, y);
    y += 8;
    doc.setDrawColor(...accent);
    doc.setLineWidth(1);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 20;
  }

  function row(label, value) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...muted);
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...text);
    doc.text(String(value), marginX + 170, y);
    y += 18;
  }

  function ensureSpace(needed) {
    if (y + needed > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      y = 56;
    }
  }

  // --- Header -------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...accent);
  doc.text("Study Phone Detector Pro", marginX, y);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...muted);
  doc.text(`Report generated ${new Date().toLocaleString()}`, marginX, y);
  y += 10;
  if (user?.name) {
    doc.text(`Prepared for ${user.name}${user.email ? ` (${user.email})` : ""}`, marginX, y);
    y += 10;
  }
  y += 20;

  // --- Today's summary ------------------------------------------------
  heading("Today's Summary");
  row("Focused time", `${Math.round((stats.today?.focusedMs || 0) / 60000)} minutes`);
  row("Distraction time", `${Math.round((stats.today?.distractionMs || 0) / 60000)} minutes`);
  row("Site violations", stats.today?.violations || 0);
  row("Phone check-ins", `${stats.today?.phoneDetections || 0} of ${settings.maxPhoneDetectionsPerDay ?? 5} allowed`);
  row("Daily goal", `${settings.dailyGoalMinutes} minutes`);
  row("Current streak", `${stats.streak || 0} day(s)`);
  y += 12;

  // --- Weekly breakdown -------------------------------------------------
  ensureSpace(140);
  heading("Last 7 Days");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  doc.text("Day", marginX, y);
  doc.text("Focused (min)", marginX + 140, y);
  doc.text("Distraction (min)", marginX + 280, y);
  y += 6;
  doc.setDrawColor(220, 224, 232);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 14;

  (stats.week || []).forEach((day) => {
    ensureSpace(20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...text);
    doc.text(day.label || "-", marginX, y);
    doc.text(String(day.focusedMinutes ?? 0), marginX + 140, y);
    doc.text(String(day.distractionMinutes ?? 0), marginX + 280, y);
    y += 18;
  });
  y += 12;

  // --- Study tasks ------------------------------------------------------
  ensureSpace(60);
  heading("Study Tasks");
  if (!todos || !todos.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...muted);
    doc.text("No tasks recorded.", marginX, y);
    y += 18;
  } else {
    todos.slice(0, 25).forEach((todo) => {
      ensureSpace(18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(...text);
      const mark = todo.done ? "[x]" : "[ ]";
      doc.text(`${mark} ${todo.text}`, marginX, y);
      y += 16;
    });
  }

  doc.save(`study-phone-detector-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
