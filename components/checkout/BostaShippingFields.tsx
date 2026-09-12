"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "#root/components/ui/button";
import { Label } from "#root/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#root/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#root/components/ui/popover";
import { cn } from "#root/lib/utils";
import { trpc } from "#root/shared/trpc/client";

/**
 * Exact Bosta location the customer picked. `districtId` is what reaches
 * order creation — the server never guesses a district from free text.
 */
export interface BostaShippingSelection {
  cityId: string;
  city: string;
  zoneId: string;
  zone: string;
  districtId: string;
  districtName: string;
}

interface BostaShippingFieldsProps {
  value: BostaShippingSelection | null;
  onChange: (value: BostaShippingSelection | null) => void;
  /**
   * Fired once the component knows whether Bosta locations are available.
   * `true` = the picker is shown and a district must be selected;
   * `false` = Bosta is disabled/unreachable and `fallback` is rendered.
   */
  onAvailabilityChange?: (available: boolean) => void;
  /** Rendered instead of the picker when Bosta is not enabled. */
  fallback?: ReactNode;
  error?: string;
  className?: string;
}

type CityTree = Array<{
  cityId: string;
  cityName: string;
  zones: Array<{
    zoneId: string;
    zoneName: string;
    districts: Array<{ districtId: string; districtName: string }>;
  }>;
}>;

function SearchCombobox({
  id,
  label,
  placeholder,
  searchPlaceholder,
  value,
  options,
  disabled,
  invalid,
  onSelect,
}: {
  id: string;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  disabled?: boolean;
  invalid?: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.id === value)?.label ?? "";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              invalid && "border-destructive",
            )}
          >
            <span className="truncate">{selectedLabel || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.label}
                    onSelect={() => {
                      onSelect(option.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === option.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * City / Governorate → Area (zone) → District pickers fed by Bosta's own
 * location list. Degrades to `fallback` (plain inputs) when Bosta is not
 * configured or its API cannot be reached, so checkout never blocks.
 */
export function BostaShippingFields({
  value,
  onChange,
  onAvailabilityChange,
  fallback = null,
  error,
  className,
}: BostaShippingFieldsProps) {
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState<CityTree>([]);
  const [cityId, setCityId] = useState(value?.cityId ?? "");
  const [zoneId, setZoneId] = useState(value?.zoneId ?? "");
  const [districtId, setDistrictId] = useState(value?.districtId ?? "");

  const availabilityRef = useRef(onAvailabilityChange);
  availabilityRef.current = onAvailabilityChange;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let tree: CityTree = [];
      try {
        const res = await trpc.order.bosta.listShippingLocations.query();
        tree = res.cities;
      } catch (err) {
        console.warn("[Checkout] Could not load Bosta delivery areas:", err);
      }
      if (cancelled) return;
      setCities(tree);
      setLoading(false);
      availabilityRef.current?.(tree.length > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cityOptions = useMemo(
    () => cities.map((c) => ({ id: c.cityId, label: c.cityName })),
    [cities],
  );
  const selectedCity = cities.find((c) => c.cityId === cityId);
  const zoneOptions = useMemo(
    () => (selectedCity?.zones ?? []).map((z) => ({ id: z.zoneId, label: z.zoneName })),
    [selectedCity],
  );
  const selectedZone = selectedCity?.zones.find((z) => z.zoneId === zoneId);
  const districtOptions = useMemo(
    () =>
      (selectedZone?.districts ?? []).map((d) => ({ id: d.districtId, label: d.districtName })),
    [selectedZone],
  );

  // Publish the selection upward whenever all three levels are chosen.
  useEffect(() => {
    if (!cityId || !zoneId || !districtId) {
      if (value) onChangeRef.current(null);
      return;
    }
    const city = cities.find((c) => c.cityId === cityId);
    const zone = city?.zones.find((z) => z.zoneId === zoneId);
    const district = zone?.districts.find((d) => d.districtId === districtId);
    if (!city || !zone || !district) return;

    if (value?.districtId !== district.districtId) {
      onChangeRef.current({
        cityId: city.cityId,
        city: city.cityName,
        zoneId: zone.zoneId,
        zone: zone.zoneName,
        districtId: district.districtId,
        districtName: district.districtName,
      });
    }
  }, [cityId, zoneId, districtId, cities, value]);

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground py-2", className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading delivery areas…
      </div>
    );
  }

  if (cities.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SearchCombobox
          id="bostaCity"
          label="Governorate"
          placeholder="Governorate *"
          searchPlaceholder="Search governorates…"
          value={cityId}
          options={cityOptions}
          invalid={!!error && !cityId}
          onSelect={(id) => {
            setCityId(id);
            setZoneId("");
            setDistrictId("");
          }}
        />
        <SearchCombobox
          id="bostaZone"
          label="Area"
          placeholder="Area *"
          searchPlaceholder="Search areas…"
          value={zoneId}
          options={zoneOptions}
          disabled={!cityId}
          invalid={!!error && !!cityId && !zoneId}
          onSelect={(id) => {
            setZoneId(id);
            setDistrictId("");
          }}
        />
        <SearchCombobox
          id="bostaDistrict"
          label="District"
          placeholder="District *"
          searchPlaceholder="Search districts…"
          value={districtId}
          options={districtOptions}
          disabled={!zoneId}
          invalid={!!error && !!zoneId && !districtId}
          onSelect={setDistrictId}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
