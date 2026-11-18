'use client';

import { Icon } from './ui';

export type FeatureCardKind = 'discover' | 'chatrooms' | 'games' | 'treehouse' | 'weekly' | 'events' | 'business';

type FeatureCardProps = {
  kind: FeatureCardKind;
  iconName: string;
  title: string;
  text: string;
  extra?: string | null;
  badge?: string | null;
  actionText: string;
  onClick: () => void;
  ariaLabel?: string;
};

export function FeatureCard({ kind, iconName, title, text, extra, badge, actionText, onClick, ariaLabel }: FeatureCardProps) {
  return (
    <button type="button" className={`hm-feature ${kind}`} onClick={onClick} aria-label={ariaLabel}>
      <span className="hf-top">
        <span className="hf-icon"><Icon name={iconName} cls={kind === 'discover' ? 'fill' : ''} /></span>
        {badge ? <span className="hf-badge">{badge}</span> : null}
      </span>
      <b>{title}</b>
      <span className="hf-text">{text}{extra ? <span className="hf-extra">{extra}</span> : null}</span>
      <span className="hf-go">{actionText}<Icon name="chev" cls="sm" /></span>
    </button>
  );
}
