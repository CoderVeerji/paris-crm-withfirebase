// Admin ki di hui list (State_List / Lead_Sources) se hi chunna — user khud kuch type nahi kar sakta.
// Purane lead mein agar list se bahar ki value padi ho to wo bas dikhne ke liye ek extra option ban jaati hai
// (taaki edit kholne par data chupke se na badal jaye) — par naya kuch likha nahi ja sakta.
import { useT } from '../i18n';

export default function ListSelect({ value, onChange, options, placeholder = '—', ...rest }) {
  const { t } = useT();
  const v = value || '';
  const legacy = v && !options.includes(v);
  return (
    <select className="form-control" value={v} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{placeholder}</option>
      {legacy && <option value={v}>{v} ({t('lsNotInList')})</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
