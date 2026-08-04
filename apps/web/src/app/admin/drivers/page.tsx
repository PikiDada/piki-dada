"use client";

import { useEffect, useState } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch, apiUrl } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { DocumentType, DriverProfile } from "@/lib/types";

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  NATIONAL_ID: "National ID",
  DRIVING_PERMIT: "Driving Permit",
  VEHICLE_REGISTRATION: "Motorcycle Registration",
  INSURANCE: "Insurance",
};

async function downloadDocument(docId: string, docType: DocumentType, driverName: string) {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(apiUrl(`/admin/documents/${docId}`), {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    alert("Could not load document. Please try again.");
    return;
  }
  const blob = await res.blob();
  const mimeToExt: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const ext = mimeToExt[blob.type] ?? "jpg";
  const filename = `${driverName} ${DOCUMENT_LABELS[docType]}.${ext}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function downloadAllDocuments(driverName: string, documents: Array<{ id: string; type: DocumentType }>) {
  if (documents.length === 0) {
    alert("No documents to download.");
    return;
  }

  const zip = new JSZip();
  const token = useAuthStore.getState().accessToken;
  let successCount = 0;

  for (const doc of documents) {
    try {
      const res = await fetch(apiUrl(`/admin/documents/${doc.id}`), {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) continue;

      const blob = await res.blob();
      const mimeToExt: Record<string, string> = {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const ext = mimeToExt[blob.type] ?? "jpg";
      const filename = `${driverName} ${DOCUMENT_LABELS[doc.type]}.${ext}`;
      zip.file(filename, blob);
      successCount++;
    } catch (err) {
      console.error(`Failed to download ${doc.type}:`, err);
    }
  }

  if (successCount === 0) {
    alert("Could not download any documents. Please try again.");
    return;
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${driverName}_documents.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-8 text-neutral-400">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
      <span className="text-sm">Loading...</span>
    </div>
  );
}

export default function AdminDriversPage() {
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch<DriverProfile[]>("/drivers/pending")
      .then(setDrivers)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(id: string) {
    await apiFetch(`/drivers/${id}/approve`, { method: "PATCH" });
    load();
  }

  async function reject(id: string) {
    await apiFetch(`/drivers/${id}/reject`, { method: "PATCH" });
    load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Pending driver approvals</h1>
      <div className="space-y-3">
        {loading ? <Spinner /> : drivers.length === 0 && <p className="text-neutral-400">No pending drivers.</p>}
        {drivers.map((d) => (
          <Card key={d.id}>
            <CardContent className="flex items-center justify-between pt-4">
              <div>
                <p className="font-medium">{d.user.name}</p>
                <p className="text-sm text-neutral-500">{d.user.email}</p>
                {d.vehicle ? (
                  <p className="text-sm text-neutral-500">
                    {d.vehicle.make} {d.vehicle.model} · {d.vehicle.plateNumber} ·{" "}
                    {d.vehicle.rideType}
                  </p>
                ) : (
                  <p className="text-sm text-yellow-600">No vehicle added yet</p>
                )}
                {d.documents.length === 0 ? (
                  <p className="text-xs text-neutral-400">No documents uploaded</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {d.documents.map((doc) => {
                      const isImage = /\.(jpe?g|png|webp)/i.test(doc.fileUrl);
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => downloadDocument(doc.id, doc.type, d.user.name)}
                          className="flex flex-col items-center gap-1 text-xs text-neutral-500 hover:text-black"
                        >
                          {isImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={doc.fileUrl}
                              alt={DOCUMENT_LABELS[doc.type]}
                              className="h-16 w-24 rounded-md border border-neutral-200 object-cover"
                            />
                          ) : (
                            <span className="flex h-16 w-24 items-center justify-center rounded-md border border-neutral-200 text-[11px] uppercase">
                              PDF
                            </span>
                          )}
                          <span className="underline">{DOCUMENT_LABELS[doc.type]}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {d.documents.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => downloadAllDocuments(d.user.name, d.documents)}>
                    Download All
                  </Button>
                )}
                <Button size="sm" onClick={() => approve(d.id)} disabled={!d.vehicle}>
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => reject(d.id)}>
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
