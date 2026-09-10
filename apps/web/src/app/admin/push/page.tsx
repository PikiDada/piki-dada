"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

interface BroadcastLog {
  id: string;
  title: string;
  body: string;
  url: string | null;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

export default function AdminPushPage() {
  const [history, setHistory] = useState<BroadcastLog[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function load() {
    apiFetch<BroadcastLog[]>("/admin/push/history").then(setHistory);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const res = await apiFetch<{ sentCount: number; failedCount: number }>(
        "/admin/push/broadcast",
        { method: "POST", body: JSON.stringify({ title, body, url: url || undefined }) },
      );
      setResult(`Sent to ${res.sentCount} subscriber(s), ${res.failedCount} failed.`);
      setTitle("");
      setBody("");
      setUrl("");
      load();
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Push notifications</h1>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Send broadcast</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSend} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Message</Label>
                <Input required value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Target URL (optional)</Label>
                <Input
                  placeholder="/passenger"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              {result && <p className="text-sm text-green-600">{result}</p>}
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? "Sending..." : "Send to all subscribers"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-2 lg:col-span-2">
          {history.length === 0 && <p className="text-sm text-neutral-600">No broadcasts sent yet.</p>}
          {history.map((log) => (
            <Card key={log.id}>
              <CardContent className="pt-4">
                <p className="font-medium">{log.title}</p>
                <p className="text-sm text-neutral-600">{log.body}</p>
                <p className="mt-2 text-xs text-neutral-600">
                  {new Date(log.createdAt).toLocaleString()} · sent {log.sentCount} · failed{" "}
                  {log.failedCount}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
