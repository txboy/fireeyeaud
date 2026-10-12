import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** 图片预览：默认适应窗口，可切换原始大小（可滚动）。 */
export function ImagePreview({
  data,
  mime,
  name,
}: {
  data: string;
  mime: string;
  name: string;
}) {
  const { t } = useTranslation('preview');
  const [natural, setNatural] = useState(false);
  const src = `data:${mime};base64,${data}`;

  return (
    <div className="imgpreview">
      <div className="imgpreview__bar">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setNatural((value) => !value)}
        >
          {natural ? t('fit') : '100%'}
        </button>
      </div>
      <div
        className={`imgpreview__stage${natural ? ' imgpreview__stage--natural' : ''}`}
      >
        <img src={src} alt={name} />
      </div>
    </div>
  );
}
