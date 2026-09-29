import { Monitor, Moon, Sun } from 'lucide-react'
import { type SegmentOption, SegmentedControl } from './SegmentedControl'
import { type ThemePreference, useTheme } from './useTheme'

const OPTIONS: SegmentOption<ThemePreference>[] = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

export function ThemeSwitcher() {
  const [theme, setTheme] = useTheme()
  return <SegmentedControl label="Theme" iconOnly options={OPTIONS} value={theme} onChange={setTheme} />
}
