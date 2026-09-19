import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ImagePlus,
  Save,
  Check,
  Loader2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { getUserProfile, setUserProfile } from "../../db";
import type { UserProfile } from "../../types";
import { Avatar } from "../common/Avatar";
import { ImageCropperModal } from "../common/ImageCropperModal";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PersonaPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropImage, setCropImage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getUserProfile()
      .then((p) => {
        setProfile(p);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Не удалось загрузить профиль.");
        setLoading(false);
      });
  }, []);

  const handleAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;

    try {
      const raw = await fileToDataUrl(file);
      setCropImage(raw);
    } catch {
      setError("Не удалось прочитать выбранное изображение.");
    } finally {
      e.currentTarget.value = "";
    }
  };

  const handleSave = async () => {
    if (!profile || saving) return;
    setSaving(true);
    setError(null);

    try {
      await setUserProfile(profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 md:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          Личность и альтер-эго
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          Мои персоны
        </h1>
        <p className="mt-1 text-sm text-content-secondary">
          Как вас видят, воспринимают и называют персонажи в диалогах.
        </p>
      </header>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-xs text-danger">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {profile && (
        <div className="space-y-6">
          {/* Интерактивная карточка персоны */}
          <section className="rounded-3xl border border-white/[0.08] bg-[#121620]/90 p-6 backdrop-blur-xl shadow-xl">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <div className="relative shrink-0">
                <Avatar
                  src={profile.avatarUrl}
                  name={profile.name || "Странник"}
                  size={96}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.1] bg-accent text-on-accent shadow-md transition-transform hover:scale-105"
                  title="Сменить аватар"
                >
                  <ImagePlus size={16} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFile}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
                  <Sparkles size={14} />
                  <span>Активная персона</span>
                </div>
                <h2 className="mt-1 text-xl font-bold text-zinc-100">
                  {profile.name || "Странник"}
                </h2>
                <p className="mt-1 text-xs text-content-secondary line-clamp-2">
                  {profile.personaDescription || "Загадочный гость этого мира."}
                </p>
              </div>
            </div>
          </section>

          {/* Форма редактирования */}
          <section className="space-y-5 rounded-3xl border border-white/[0.07] bg-[#121620]/90 p-6 backdrop-blur-xl">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-content-secondary">
                Имя в ролевых историях
              </label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                placeholder="Например: Алекс"
                className="input-field text-sm font-semibold"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-content-secondary">
                Описание персоны (Persona Context)
              </label>
              <p className="mb-2 text-xs text-content-muted">
                Этот текст подмешивается в системный контекст диалога. Опишите внешность, манеры, социальный статус или предысторию вашего альтер-эго.
              </p>
              <textarea
                rows={7}
                value={profile.personaDescription}
                onChange={(e) =>
                  setProfile({ ...profile, personaDescription: e.target.value })
                }
                placeholder="Высокий парень в темном пальто, сдержанный, внимательный к деталям..."
                className="input-field resize-y text-sm leading-relaxed"
              />
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.07] pt-4">
              <span className="text-xs text-content-muted">
                {saved ? "✓ Профиль сохранён." : "Изменения влияют на все новые ответы модели."}
              </span>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-on-accent shadow-[0_0_20px_rgba(139,92,246,0.25)] hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : saved ? (
                  <Check size={16} />
                ) : (
                  <Save size={16} />
                )}
                <span>Сохранить персону</span>
              </button>
            </div>
          </section>
        </div>
      )}

      <ImageCropperModal
        open={!!cropImage}
        imageSrc={cropImage}
        onClose={() => setCropImage(null)}
        onCropComplete={(cropped) => {
          setCropImage(null);
          if (profile) setProfile({ ...profile, avatarUrl: cropped });
        }}
      />
    </div>
  );
}