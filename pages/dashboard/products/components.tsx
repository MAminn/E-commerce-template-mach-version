"use client";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { cn } from "#root/lib/utils";
import { Button } from "#root/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "#root/components/ui/form";
import { Input } from "#root/components/ui/input";
import { Textarea } from "#root/components/ui/textarea";
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
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  XIcon,
  Zap,
  Palette,
} from "lucide-react";
import { FileUploadInput } from "#root/components/file-uploads/FileUpload";
import { MultiFileUploadInput } from "#root/components/file-uploads/MultiFileUpload";

import { Label } from "#root/components/ui/label";
import { Badge } from "#root/components/ui/badge";
import { Switch } from "#root/components/ui/switch";
import { trpc } from "#root/shared/trpc/client";
import {
  isSupplementStore,
  showsDescriptionColorControls,
  showsPerfumeProductFields,
  showsVariantPriceModifiers,
} from "#root/shared/config/branding";

// Define the interface to match our component
export interface FileMetadata {
  id: string;
  url?: string;
  diskname?: string;
  isPrimary?: boolean;
}

/**
 * Generic picker for a curated, ordered list of OTHER products.
 *
 * Stores product IDs only — the storefront resolves live name/price/image/stock
 * from the referenced products, so no product data is ever duplicated into the
 * relationship. Selection order is the display order and is preserved.
 *
 * Used for both the add-ons strip and the related-products grid; the wording is
 * supplied by the caller so no vertical-specific copy lives in here.
 */
function ProductRefPicker({
  value,
  onChange,
  excludeProductId,
  label,
  description,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  excludeProductId?: string;
  label: string;
  description: string;
}) {
  const [options, setOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    trpc.product.view
      .query({ limit: 100 })
      .then((res) => {
        if (cancelled || !res.success || !res.result) return;
        const items = (res.result.products ?? [])
          .map((p: any) => ({ id: p.product.id as string, name: p.product.name as string }))
          .filter((p: { id: string }) => p.id !== excludeProductId);
        setOptions(items);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [excludeProductId]);

  // Follow the admin's chosen order, not the catalogue fetch order.
  const selected = value
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is { id: string; name: string } => Boolean(o));

  const move = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [id] = next.splice(idx, 1);
    next.splice(target, 0, id!);
    onChange(next);
  };

  return (
    <FormItem className='flex flex-col'>
      <FormLabel>{label}</FormLabel>
      <p className='text-xs text-muted-foreground -mt-1 mb-1'>{description}</p>
      {selected.length > 0 && (
        <div className='flex flex-wrap gap-2 mb-2'>
          {selected.map((p, idx) => (
            <Badge key={p.id} className='ps-1 pe-2 py-1 gap-1'>
              <button
                type='button'
                aria-label='Move earlier'
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
                className='disabled:opacity-30'>
                <ChevronUp className='h-3 w-3' />
              </button>
              <button
                type='button'
                aria-label='Move later'
                disabled={idx === selected.length - 1}
                onClick={() => move(idx, 1)}
                className='disabled:opacity-30'>
                <ChevronDown className='h-3 w-3' />
              </button>
              <span>{p.name}</span>
              <button
                type='button'
                aria-label='Remove'
                onClick={() => onChange(value.filter((id) => id !== p.id))}>
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <FormControl>
            <Button
              type='button'
              variant='outline'
              disabled={isLoading}
              className={cn(
                "w-full justify-between",
                value.length === 0 && "text-muted-foreground",
              )}>
              {isLoading
                ? "Loading products…"
                : value.length === 0
                  ? "Select products"
                  : `${value.length} product${value.length === 1 ? "" : "s"} selected`}
              <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent className='w-full p-0'>
          <Command>
            <CommandInput placeholder='Search products...' />
            <CommandList>
              <CommandEmpty>No products found.</CommandEmpty>
              <CommandGroup>
                {options.map((p) => {
                  const isSelected = value.includes(p.id);
                  return (
                    <CommandItem
                      key={p.id}
                      onSelect={() => {
                        if (isSelected) {
                          onChange(value.filter((id) => id !== p.id));
                        } else {
                          onChange([...value, p.id]);
                        }
                      }}>
                      <div className='flex items-center'>
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {p.name}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FormItem>
  );
}

/**
 * Comma-separated text input for the badges array. Keeps its own local raw
 * text so a trailing/mid-typing comma isn't immediately stripped by the
 * split+trim+filter pass (that pass only runs when committing to the array).
 */
function BadgesInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (badges: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));

  useEffect(() => {
    setText(value.join(", "));
    // Only resync from external value changes (e.g. form reset), not our own keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.join(",")]);

  return (
    <FormItem>
      <FormLabel>Badges (comma-separated)</FormLabel>
      <FormControl>
        <Input
          placeholder='Vegan, Cruelty-free, Clean ingredients'
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            );
          }}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

type SupplementFactRow = {
  label: string;
  amount?: string;
  dailyValue?: string;
  indent?: boolean;
};

/**
 * Repeatable editor for the Supplement Facts panel.
 *
 * Nutrient names are never hard-coded — every row is free text, so any panel
 * (protein, vitamins, amino profiles) can be entered. Array order IS the
 * display order, so reordering here reorders the stored JSON array.
 */
function SupplementFactsInput({
  value,
  onChange,
}: {
  value: SupplementFactRow[];
  onChange: (rows: SupplementFactRow[]) => void;
}) {
  const rows = value ?? [];

  const update = (idx: number, patch: Partial<SupplementFactRow>) => {
    const next = [...rows];
    next[idx] = { ...next[idx]!, ...patch };
    onChange(next);
  };

  const move = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(idx, 1);
    next.splice(target, 0, row!);
    onChange(next);
  };

  return (
    <FormItem>
      <FormLabel>Supplement Facts</FormLabel>
      <p className='text-xs text-muted-foreground -mt-1'>
        One row per line of the panel. Amount and Daily Value are optional —
        leave Daily Value empty where the label shows none. Use Indent for a
        sub-nutrient (e.g. Dietary Fiber under Total Carbohydrate).
      </p>
      <div className='space-y-2'>
        {rows.map((row, idx) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
            key={idx}
            className='flex items-center gap-1.5'>
            <div className='flex flex-col'>
              <button
                type='button'
                aria-label='Move row up'
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
                className='h-4 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30'>
                <ChevronUp className='h-3.5 w-3.5' />
              </button>
              <button
                type='button'
                aria-label='Move row down'
                disabled={idx === rows.length - 1}
                onClick={() => move(idx, 1)}
                className='h-4 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30'>
                <ChevronDown className='h-3.5 w-3.5' />
              </button>
            </div>
            <Input
              className={cn("flex-1", row.indent && "ms-4")}
              placeholder='Label (e.g. Protein)'
              value={row.label}
              onChange={(e) => update(idx, { label: e.target.value })}
            />
            <Input
              className='w-28 flex-shrink-0'
              placeholder='24 g'
              value={row.amount ?? ""}
              onChange={(e) => update(idx, { amount: e.target.value })}
            />
            <Input
              className='w-20 flex-shrink-0'
              placeholder='%DV'
              value={row.dailyValue ?? ""}
              onChange={(e) => update(idx, { dailyValue: e.target.value })}
            />
            <button
              type='button'
              title={row.indent ? "Sub-nutrient — click to un-indent" : "Click to indent as a sub-nutrient"}
              onClick={() => update(idx, { indent: !row.indent })}
              className={cn(
                "flex-shrink-0 text-[10px] px-1.5 py-1 rounded border font-medium transition-colors",
                row.indent
                  ? "border-blue-500 text-blue-600 bg-blue-50 hover:bg-blue-100"
                  : "border-gray-300 text-gray-500 hover:bg-gray-50",
              )}>
              Indent
            </button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              aria-label='Remove row'
              className='h-8 w-8 text-destructive hover:text-destructive flex-shrink-0'
              onClick={() => onChange(rows.filter((_, i) => i !== idx))}>
              <XIcon className='w-3.5 h-3.5' />
            </Button>
          </div>
        ))}
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => onChange([...rows, { label: "" }])}>
          + Add Row
        </Button>
      </div>
    </FormItem>
  );
}

export function ProductForm({
  initialValues,
  categories,
  vendors = [],
  onSuccess,
  isLoading = false,
}: {
  initialValues?: Partial<{
    id: string;
    name: string;
    description: string;
    price: number;
    discountPrice?: number | null;
    stock: number;
    imageId: string;
    productImages: FileMetadata[];
    categoryId: string;
    categoryIds: string[];
    variants: { name: string; values: { value: string; priceModifier?: number }[] }[];
    inspiredBy?: string;
    sortOrder?: number;
    hidden?: boolean;
    fragranceInfo?: {
      tagline?: string;
      taglineAr?: string;
      about?: string;
      aboutAr?: string;
      longevity?: string;
      longevityAr?: string;
      whenToUse?: string;
      whenToUseAr?: string;
      concentration?: string;
      scentIntensity?: string;
      scentIntensityAr?: string;
      gender?: string;
      genderAr?: string;
      topNotes?: string;
      topNotesAr?: string;
      middleNotes?: string;
      middleNotesAr?: string;
      baseNotes?: string;
      baseNotesAr?: string;
      ingredients?: string;
      ingredientsAr?: string;
      badges?: string[];
    } | null;
    bestLayeredWithIds?: string[] | null;
    sku?: string | null;
    supplementInfo?: {
      detailsHeading?: string;
      netWeight?: string;
      servingSize?: string;
      servingsPerContainer?: string;
      ingredients?: string;
      directions?: string;
      warnings?: string;
      longDescription?: string;
      badges?: string[];
      supplementFacts?: SupplementFactRow[];
      relatedProductIds?: string[];
    } | null;
  }>;
  categories: { id: string; name: string }[];
  vendors?: { id: string; name: string }[];
  onSuccess?: () => void;
  isLoading?: boolean;
}) {
  // The inherited perfume-era product fields (Inspired By, Fragrance Info,
  // Best Layered With) are keyed off the store's business vertical, NOT off
  // any template selection — a supplement store stays a supplement store
  // whichever landing template the client picks.
  //
  // They are hidden rather than removed: the zod schema, the form state and
  // the create/update payload are unchanged, so legacy values round-trip
  // untouched on edit and nothing is required on create.
  const showPerfumeFields = showsPerfumeProductFields();
  // The description Color control emits [color:#hex] markup that only
  // ProductPageMinimal parses back out — every other product template,
  // including the active one, would show it to customers verbatim.
  const showColorControls = showsDescriptionColorControls();

  const formSchema = z.object({
    name: z.string().min(1, "Product name is required"),
    description: z
      .string()
      .min(1, "Product description is required")
      .max(3000, "Description must be less than 3000 characters"),
    price: z.coerce.number().min(0, "Price must be greater than 0"),
    discountPrice: z.coerce
      .number()
      .min(0, "Discount price must be greater than 0")
      .nullable()
      .optional(),
    stock: z.coerce.number().int().min(0, "Stock must be greater than 0"),
    imageId: z.string().default(""),
    productImages: z
      .array(
        z.object({
          id: z.string(),
          url: z.string().optional(),
          diskname: z.string().optional(),
          isPrimary: z.boolean().optional(),
        }),
      )
      .min(1, "At least one product image is required")
      .default([]),
    categoryId: z.string().min(1, "Primary category is required"),
    categoryIds: z
      .array(z.string())
      .min(1, "At least one category is required"),
    variants: z
      .array(
        z.object({
          name: z.string(),
          values: z.array(
            z.object({
              value: z.string(),
              priceModifier: z.number().min(0).optional(),
              enabledOverride: z.boolean().optional(),
            }),
          ),
        }),
      )
      .optional(),
    inspiredBy: z.string().max(1000).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    hidden: z.boolean().default(false),
    fragranceInfo: z
      .object({
        tagline: z.string().max(200).optional(),
        taglineAr: z.string().max(200).optional(),
        about: z.string().max(1000).optional(),
        aboutAr: z.string().max(1000).optional(),
        longevity: z.string().max(200).optional(),
        longevityAr: z.string().max(200).optional(),
        whenToUse: z.string().max(200).optional(),
        whenToUseAr: z.string().max(200).optional(),
        concentration: z.string().max(50).optional(),
        scentIntensity: z.string().max(50).optional(),
        scentIntensityAr: z.string().max(50).optional(),
        gender: z.string().max(50).optional(),
        genderAr: z.string().max(50).optional(),
        topNotes: z.string().max(300).optional(),
        topNotesAr: z.string().max(300).optional(),
        middleNotes: z.string().max(300).optional(),
        middleNotesAr: z.string().max(300).optional(),
        baseNotes: z.string().max(300).optional(),
        baseNotesAr: z.string().max(300).optional(),
        ingredients: z.string().max(1500).optional(),
        ingredientsAr: z.string().max(1500).optional(),
        badges: z.array(z.string().max(50)).max(10).optional(),
      })
      .optional(),
    bestLayeredWithIds: z.array(z.string()).optional().default([]),
    sku: z.string().max(64).optional(),
    supplementInfo: z
      .object({
        detailsHeading: z.string().max(120).optional(),
        netWeight: z.string().max(60).optional(),
        servingSize: z.string().max(60).optional(),
        servingsPerContainer: z.string().max(60).optional(),
        ingredients: z.string().max(4000).optional(),
        directions: z.string().max(2000).optional(),
        warnings: z.string().max(2000).optional(),
        longDescription: z.string().max(6000).optional(),
        badges: z.array(z.string().max(50)).max(10).optional(),
        supplementFacts: z
          .array(
            z.object({
              label: z.string().max(120),
              amount: z.string().max(60).optional(),
              dailyValue: z.string().max(20).optional(),
              indent: z.boolean().optional(),
            }),
          )
          .max(60)
          .optional(),
        relatedProductIds: z.array(z.string()).max(24).optional(),
      })
      .optional(),
  });

  // Debug initial values
  console.log("ProductForm received initialValues:", initialValues);

  // Initialize form with validated values
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialValues?.name || "",
      description: initialValues?.description || "",
      inspiredBy: initialValues?.inspiredBy || "",
      sortOrder: initialValues?.sortOrder || 0,
      price: initialValues?.price || 0,
      discountPrice: initialValues?.discountPrice || null,
      stock: initialValues?.stock || 0,
      // Use the primary image ID as the main imageId
      imageId: initialValues?.imageId || "",
      // Ensure we have a valid array of product images
      productImages: Array.isArray(initialValues?.productImages)
        ? initialValues.productImages
        : [],
      // Ensure we have a valid array of variants
      variants: Array.isArray(initialValues?.variants)
        ? initialValues.variants
        : [],
      // Ensure we have valid category IDs
      categoryIds: Array.isArray(initialValues?.categoryIds)
        ? initialValues.categoryIds
        : [],
      // Get the primary category from categoryIds if available, or fallback to the provided categoryId
      categoryId:
        Array.isArray(initialValues?.categoryIds) &&
        initialValues?.categoryIds.length > 0
          ? initialValues.categoryIds[0]
          : initialValues?.categoryId || "",
      hidden: initialValues?.hidden ?? false,
      fragranceInfo: initialValues?.fragranceInfo ?? undefined,
      bestLayeredWithIds: Array.isArray(initialValues?.bestLayeredWithIds)
        ? initialValues.bestLayeredWithIds
        : [],
      sku: initialValues?.sku ?? "",
      supplementInfo: initialValues?.supplementInfo ?? undefined,
    },
  });

  // Watch form values for debugging
  const watchedValues = form.watch();

  // Log key form values to help debug
  useEffect(() => {
    console.log("Form values updated:", {
      categoryIds: watchedValues.categoryIds,
      categoryId: watchedValues.categoryId,
      productImages: watchedValues.productImages.length,
    });
  }, [
    watchedValues.categoryIds,
    watchedValues.categoryId,
    watchedValues.productImages,
  ]);

  // Watch categoryIds to update categoryId (primary category)
  const categoryIds = form.watch("categoryIds");

  // Update the primary categoryId whenever categoryIds changes
  useEffect(() => {
    if (categoryIds && categoryIds.length > 0) {
      // Ensure we handle potential undefined safely
      const primaryCategoryId = categoryIds[0] ? categoryIds[0] : "";
      console.log("Setting primary categoryId to:", primaryCategoryId);

      // Only update if the value changed to avoid unnecessary rerenders
      if (form.getValues("categoryId") !== primaryCategoryId) {
        form.setValue("categoryId", primaryCategoryId, {
          shouldValidate: true,
        });
      }
    } else {
      console.log("No categories selected, clearing primary categoryId");
      form.setValue("categoryId", "", { shouldValidate: false });
    }
  }, [categoryIds, form]);

  // Log form values for debugging
  useEffect(() => {
    console.log("Form values:", form.getValues());
  }, [form]);

  const [submitting, setSubmitting] = useState(false);

  const handleFormSubmit = async (values: z.infer<typeof formSchema>) => {
    setSubmitting(true);
    console.log("Submitting form with values:", values);

    // Ensure we have at least one image that is primary
    if (values.productImages && values.productImages.length > 0) {
      // If no primary image is set, make the first one primary
      if (!values.productImages.some((img) => img?.isPrimary)) {
        console.log("No primary image found, setting first image as primary");
        if (values.productImages[0]) {
          values.productImages[0].isPrimary = true;
        }
      }

      // Set the primary image's ID as the main imageId for backward compatibility
      const primaryImage = values.productImages.find((img) => img?.isPrimary);
      if (primaryImage?.id) {
        console.log("Using primary image ID:", primaryImage.id);
        values.imageId = primaryImage.id;
      } else if (values.productImages[0]?.id) {
        console.log(
          "No primary image, using first image ID:",
          values.productImages[0].id,
        );
        values.imageId = values.productImages[0].id;
      }
    }

    // Ensure categoryId is set from categoryIds if available
    if (values.categoryIds && values.categoryIds.length > 0) {
      // Safely access the first element
      if (values.categoryIds[0]) {
        console.log(
          "Setting categoryId from categoryIds:",
          values.categoryIds[0],
        );
        values.categoryId = values.categoryIds[0];
      }
    } else if (
      values.categoryId &&
      (!values.categoryIds || values.categoryIds.length === 0)
    ) {
      // If we have a categoryId but no categoryIds, set categoryIds to include the categoryId
      console.log("Setting categoryIds from categoryId:", values.categoryId);
      values.categoryIds = [values.categoryId];
    }

    // Validate required fields
    if (!values.imageId) {
      toast.error("At least one product image is required");
      setSubmitting(false);
      return;
    }

    if (!values.categoryId || values.categoryIds.length === 0) {
      toast.error("At least one category is required");
      setSubmitting(false);
      return;
    }

    try {
      const { trpc } = await import("#root/shared/trpc/client");

      let result: { success: boolean; error?: string };
      if (initialValues?.id) {
        // Update existing product - always include variants to ensure we can remove them
        // This allows clearing all variants when editing
        const payload = {
          id: initialValues.id,
          ...values,
          // Make sure variants is included as at least an empty array
          variants: values.variants || [],
          // Convert null to undefined for type compatibility
          discountPrice: values.discountPrice ?? undefined,
        };
        result = await trpc.product.edit.mutate(payload);
      } else {
        // Create new product
        result = await trpc.product.create.mutate({
          ...values,
          imageId: values.imageId,
          // Convert null to undefined for type compatibility
          discountPrice: values.discountPrice ?? undefined,
        });
      }

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        initialValues?.id ? "Product updated!" : "Product created!",
      );
      onSuccess?.();
      if (!initialValues?.id) {
        form.reset();
      }
    } catch (error) {
      toast.error("Something went wrong");
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      {isLoading ? (
        <div className='flex justify-center items-center p-8'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900' />
          <p className='ml-3'>Loading product data...</p>
        </div>
      ) : (
        <form
          onSubmit={form.handleSubmit(handleFormSubmit)}
          className='space-y-4 max-h-[70vh] overflow-y-auto p-3'>
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder='Awesome Product' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='description'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                {showColorControls && (
                <div className='flex items-center gap-2 mb-1'>
                  <DescriptionColorButton
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <span className='text-xs text-muted-foreground'>
                    Select text, then pick a color
                  </span>
                </div>
                )}
                <FormControl>
                  <Textarea
                    id='product-description-textarea'
                    placeholder='This product is awesome because...'
                    className='resize-none'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Perfume positioning ("inspired by <designer scent>") — perfume
              verticals only. The inspiredBy column and schema are untouched. */}
          {showPerfumeFields && (
          <FormField
            control={form.control}
            name='inspiredBy'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Inspired By (Optional)</FormLabel>
                <div className='flex items-center gap-2 mb-1'>
                  <DescriptionColorButton
                    value={field.value || ""}
                    onChange={field.onChange}
                  />
                  <span className='text-xs text-muted-foreground'>
                    Select text, then pick a color
                  </span>
                </div>
                <FormControl>
                  <Textarea
                    placeholder='e.g., Inspired by Baccarat Rouge 540...'
                    className='resize-none'
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          )}

          {/* Inherited perfume-era block — perfume verticals only. */}
          {showPerfumeFields && (
          <div className='border rounded-md p-4 space-y-3'>
            <p className='text-sm font-medium'>Fragrance Info (Optional)</p>
            <p className='text-xs text-muted-foreground -mt-2'>
              Shown on the product page: character, longevity, when to wear, and notes.
            </p>
            <FormField
              control={form.control}
              name='fragranceInfo.tagline'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tagline ("This perfume is:")</FormLabel>
                  <FormControl>
                    <Input placeholder='Where sweet meets seductive' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='fragranceInfo.about'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>About the Scent</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='A warm, sensual blend of...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid grid-cols-2 gap-4'>
              <FormField
                control={form.control}
                name='fragranceInfo.longevity'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Longevity</FormLabel>
                    <FormControl>
                      <Input placeholder='e.g. 6-8 hours' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='fragranceInfo.whenToUse'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>When to Use</FormLabel>
                    <FormControl>
                      <Input placeholder='e.g. Evening, Fall/Winter' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className='grid grid-cols-3 gap-4'>
              <FormField
                control={form.control}
                name='fragranceInfo.concentration'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Concentration</FormLabel>
                    <FormControl>
                      <Input placeholder='18%' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='fragranceInfo.scentIntensity'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scent Intensity</FormLabel>
                    <FormControl>
                      <Input placeholder='Statement' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='fragranceInfo.gender'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <FormControl>
                      <Input placeholder='Feminine' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className='grid grid-cols-3 gap-4'>
              <FormField
                control={form.control}
                name='fragranceInfo.topNotes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Top Notes</FormLabel>
                    <FormControl>
                      <Input placeholder='Bergamot, Marshmallow' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='fragranceInfo.middleNotes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Middle Notes</FormLabel>
                    <FormControl>
                      <Input placeholder='Jasmine, Orris' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='fragranceInfo.baseNotes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base Notes</FormLabel>
                    <FormControl>
                      <Input placeholder='Amber, Vanilla, Musk' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name='fragranceInfo.ingredients'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ingredients</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Alcohol Denat., Fragrance/Parfum, Water/Aqua/Eau, ...'
                      className='resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='fragranceInfo.badges'
              render={({ field }) => (
                <BadgesInput value={field.value ?? []} onChange={field.onChange} />
              )}
            />
            <p className='text-xs text-muted-foreground'>
              Arabic versions can be added later via direct API if needed — English fields above are shown when no Arabic override is set.
            </p>
          </div>
          )}

          {/* Curated cross-sell strip. The DB column is still the legacy
              `best_layered_with_ids` for data compatibility, but the concept and
              the wording are neutral ecommerce add-ons. */}
          <FormField
            control={form.control}
            name='bestLayeredWithIds'
            render={({ field }) => (
              <ProductRefPicker
                value={field.value ?? []}
                onChange={field.onChange}
                excludeProductId={initialValues?.id}
                label={
                  isSupplementStore()
                    ? "Add-ons / Frequently Bought Together (Optional)"
                    : "Best Layered With (Optional)"
                }
                description='Products shown alongside this one on its product page. Use the arrows to set the order. Leave empty to hide the section.'
              />
            )}
          />

          <div className='grid grid-cols-2 gap-4'>
            <FormField
              control={form.control}
              name='price'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      placeholder='99.99'
                      {...field}
                      onChange={(e) => {
                        field.onChange(e.target.valueAsNumber);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='discountPrice'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Discount Price</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      placeholder='99.99'
                      value={field.value ?? ""}
                      onChange={(e) => {
                        field.onChange(e.target.valueAsNumber);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='stock'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stock</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      placeholder='100'
                      {...field}
                      onChange={(e) => {
                        field.onChange(e.target.valueAsNumber);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='hidden'
            render={({ field }) => (
              <FormItem>
                <div className='flex items-center justify-between rounded-lg border p-3'>
                  <div className='space-y-0.5'>
                    <FormLabel>Hide from shop</FormLabel>
                    <p className='text-xs text-muted-foreground'>
                      {field.value
                        ? "Hidden — customers cannot see or buy this product"
                        : "Visible — product appears in the shop"}
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='sortOrder'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sort Order (Optional)</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    placeholder='0'
                    {...field}
                    value={field.value ?? 0}
                    onChange={(e) => {
                      field.onChange(e.target.valueAsNumber);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='productImages'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Product Images</FormLabel>
                <FormControl>
                  <MultiFileUploadInput
                    name='productImages'
                    id='productImages'
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='categoryIds'
            render={({ field }) => (
              <FormItem className='flex flex-col'>
                <FormLabel>Categories (select multiple)</FormLabel>
                <div className='flex flex-wrap gap-2 mb-2'>
                  {field.value.map((categoryId) => {
                    const category = categories.find(
                      (c) => c.id === categoryId,
                    );
                    return category ? (
                      <Badge key={categoryId} className='p-2'>
                        {category.name}
                        <button
                          type='button'
                          className='ml-1'
                          onClick={() => {
                            const newCategoryIds = field.value.filter(
                              (id) => id !== categoryId,
                            );
                            field.onChange(newCategoryIds);
                          }}>
                          ×
                        </button>
                      </Badge>
                    ) : null;
                  })}
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        type='button'
                        variant='outline'
                        className={cn(
                          "w-full justify-between",
                          field.value.length === 0 && "text-muted-foreground",
                        )}>
                        {field.value.length === 0
                          ? "Select categories"
                          : `${field.value.length} ${
                              field.value.length === 1
                                ? "category"
                                : "categories"
                            } selected`}
                        <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className='w-full p-0'>
                    <Command>
                      <CommandInput placeholder='Search categories...' />
                      <CommandList>
                        <CommandEmpty>No categories found.</CommandEmpty>
                        <CommandGroup>
                          {categories.map((c) => (
                            <CommandItem
                              key={c.id}
                              onSelect={() => {
                                const isSelected = field.value.includes(c.id);
                                let newCategoryIds = [...field.value];

                                if (isSelected) {
                                  // Remove if already selected
                                  newCategoryIds = newCategoryIds.filter(
                                    (id) => id !== c.id,
                                  );
                                } else {
                                  // Add if not selected
                                  newCategoryIds.push(c.id);
                                }

                                field.onChange(newCategoryIds);
                              }}>
                              <div className='flex items-center'>
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    field.value.includes(c.id)
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {c.name}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Hidden field for storing the primary categoryId */}
          <input type='hidden' {...form.register("categoryId")} />

          <FormField
            name='variants'
            control={form.control}
            render={({ field }) => {
              return (
                <FormItem>
                  <FormLabel className='text-lg'>Variants (Optional)</FormLabel>
                  <p className='text-sm text-muted-foreground mb-2'>
                    {isSupplementStore()
                      ? 'Use variants for same-price options such as Flavour. A size or weight that costs a different amount must be its own product.'
                      : 'Add product variants like size, color, etc. if needed'}
                  </p>
                  <FormControl>
                    <VariantsInput
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                    />
                  </FormControl>
                </FormItem>
              );
            }}
          />

          {/* ── Supplement Information ──────────────────────────────────
              Supplement-store only. Everything here persists to the
              product.supplement_info jsonb column, except SKU which is its
              own product column. All fields are optional. */}
          {isSupplementStore() && (
          <div className='border rounded-md p-4 space-y-3'>
            <p className='text-sm font-medium'>Supplement Information</p>
            <p className='text-xs text-muted-foreground -mt-2'>
              Label data for this product. Every field is optional — leave any
              of them blank and the product still saves.
            </p>

            <FormField
              control={form.control}
              name='supplementInfo.detailsHeading'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Details Heading</FormLabel>
                  <p className='text-xs text-muted-foreground -mt-1'>
                    Short heading for the details section, separate from the full
                    product name. e.g. name "Mach Whey Blend - Vanilla - 30 Serve",
                    details heading "Whey Protein Blend".
                  </p>
                  <FormControl>
                    <Input placeholder='e.g. Whey Protein Blend' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid grid-cols-2 gap-4'>
            <FormField
              control={form.control}
              name='sku'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl>
                    <Input placeholder='e.g. MACH-WHEY-2KG' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='supplementInfo.netWeight'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Net Weight</FormLabel>
                  <FormControl>
                    <Input placeholder='e.g. 2 kg (4.4 lb)' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            </div>

            <div className='grid grid-cols-2 gap-4'>
            <FormField
              control={form.control}
              name='supplementInfo.servingSize'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Serving Size</FormLabel>
                  <FormControl>
                    <Input placeholder='e.g. 1 scoop (31 g)' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='supplementInfo.servingsPerContainer'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Servings Per Container</FormLabel>
                  <FormControl>
                    <Input placeholder='e.g. About 64' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            </div>

            <FormField
              control={form.control}
              name='supplementInfo.ingredients'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ingredients</FormLabel>
                  <FormControl>
                    <Textarea placeholder='Whey Protein Isolate, Cocoa Powder, Natural Flavour, ...' className='resize-none' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='supplementInfo.directions'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Directions</FormLabel>
                  <FormControl>
                    <Textarea placeholder='Mix 1 scoop with 250-300 ml of water or milk...' className='resize-none' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='supplementInfo.warnings'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Warnings</FormLabel>
                  <FormControl>
                    <Textarea placeholder='Not suitable for children. Consult your physician if...' className='resize-none' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='supplementInfo.badges'
              render={({ field }) => (
                <BadgesInput value={field.value ?? []} onChange={field.onChange} />
              )}
            />

            <FormField
              control={form.control}
              name='supplementInfo.supplementFacts'
              render={({ field }) => (
                <SupplementFactsInput
                  value={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />

            <FormField
              control={form.control}
              name='supplementInfo.relatedProductIds'
              render={({ field }) => (
                <ProductRefPicker
                  value={field.value ?? []}
                  onChange={field.onChange}
                  excludeProductId={initialValues?.id}
                  label='Related Products (Optional)'
                  description='Manually chosen products for the related-products grid, in this order. Leave empty to fall back automatically to other products in the same categories.'
                />
              )}
            />

            <FormField
              control={form.control}
              name='supplementInfo.longDescription'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Long Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder='The full product story, shown in the Description accordion on the product page...' className='resize-none' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          )}

          <Button type='submit' size='lg' className='w-full'>
            Submit
          </Button>
        </form>
      )}
    </Form>
  );
}

export function VariantsInput({
  value,
  onChange,
}: {
  value: { name: string; values: { value: string; priceModifier?: number; enabledOverride?: boolean }[] }[] | undefined;
  onChange: (value: { name: string; values: { value: string; priceModifier?: number; enabledOverride?: boolean }[] }[]) => void;
}) {
  // Ensure value is always an array
  const variants = value || [];

  const [presets, setPresets] = useState<
    { id: string; name: string; values: string[]; strikethroughValues?: string[] }[]
  >([]);
  const [presetsOpen, setPresetsOpen] = useState(false);

  useEffect(() => {
    trpc.settings.getVariantPresets
      .query()
      .then((result) => {
        if (result.success && Array.isArray(result.result)) {
          const fetched = result.result as unknown as { id: string; name: string; values: string[]; strikethroughValues?: string[] }[];
          setPresets(fetched);
          // Auto-apply all presets when creating a new product (empty variants)
          if ((!value || value.length === 0) && fetched.length > 0) {
            const autoApplied = fetched.map((p) => ({
              name: p.name,
              values: p.values.map((v) => ({ value: v, priceModifier: 0 })),
            }));
            onChange(autoApplied);
          }
        }
      })
      .catch(() => {});
  }, []);

  const applyPreset = (preset: { name: string; values: string[] }) => {
    // Check if a variant with this name already exists
    const existingIndex = variants.findIndex(
      (v) => v.name.toLowerCase() === preset.name.toLowerCase(),
    );
    if (existingIndex >= 0) {
      // Merge values (preserve existing modifiers, add new values with 0 modifier)
      const existing = variants[existingIndex]!;
      const existingValueStrings = existing.values.map((v) => v.value);
      const newVals = preset.values
        .filter((v) => !existingValueStrings.includes(v))
        .map((v) => ({ value: v, priceModifier: 0 }));
      const merged = [...existing.values, ...newVals];
      const newValue = [...variants];
      newValue[existingIndex] = { ...existing, values: merged };
      onChange(newValue);
    } else {
      onChange([
        ...variants,
        { name: preset.name, values: preset.values.map((v) => ({ value: v, priceModifier: 0 })) },
      ]);
    }
    setPresetsOpen(false);
    toast.success(`Applied "${preset.name}" preset`);
  };

  return (
    <div className='flex flex-col gap-2'>
      {variants.map((v, i) => (
        <Fragment
          key={`variant.${
            // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
            i
          }`}>
          <VariantInput
            value={v}
            onChange={(v) => {
              const newValue = [...variants];
              newValue[i] = v;
              onChange(newValue);
            }}
            globalStrikethroughValues={
              presets.find((p) => p.name.toLowerCase() === v.name.toLowerCase())
                ?.strikethroughValues ?? []
            }
          />
          <Button
            size='sm'
            className='self-end opacity-90'
            variant={"destructive"}
            type='button'
            onClick={() => {
              const newValue = [...variants];
              newValue.splice(i, 1);
              onChange(newValue);
            }}>
            <XIcon />
            Remove Variant
          </Button>
        </Fragment>
      ))}

      <div className='flex items-center gap-2'>
        <Button
          type='button'
          onClick={() =>
            onChange([
              ...variants,
              { name: `Variant ${variants.length + 1}`, values: [] },
            ])
          }>
          Add Variant
        </Button>
        {presets.length > 0 && (
          <Popover open={presetsOpen} onOpenChange={setPresetsOpen}>
            <PopoverTrigger asChild>
              <Button type='button' variant='outline'>
                <Zap className='mr-1 h-4 w-4' />
                Apply Preset
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-64 p-2' align='start'>
              <div className='space-y-1'>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type='button'
                    className='w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted'
                    onClick={() => applyPreset(preset)}>
                    <span className='font-medium'>{preset.name}</span>
                    <span className='text-muted-foreground ml-1 text-xs'>
                      ({preset.values.join(", ")})
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

export function VariantInput({
  value,
  onChange,
  globalStrikethroughValues = [],
}: {
  value: {
    name: string;
    values: { value: string; priceModifier?: number; enabledOverride?: boolean }[];
  };
  onChange: (value: { name: string; values: { value: string; priceModifier?: number; enabledOverride?: boolean }[] }) => void;
  /** Values that are globally strikethrough for this variant name (from preset) */
  globalStrikethroughValues?: string[];
}) {
  // Per-value price modifiers are display-only (never charged at checkout),
  // so supplement stores edit values without them. Stored modifiers are left
  // untouched in form state and round-trip unchanged on save.
  const showPriceModifiers = showsVariantPriceModifiers();
  const isSupplements = isSupplementStore();

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-col gap-1'>
        <Label>Name</Label>
        <Input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </div>

      <div className='flex flex-col gap-1'>
        <Label>{showPriceModifiers ? 'Values & Price Modifiers' : 'Values'}</Label>
        <div className='space-y-2'>
          {value.values.map((vv, idx) => {
            const isGloballyStruck = globalStrikethroughValues.includes(vv.value);
            const isOverridden = vv.enabledOverride === true;
            return (
            <div key={idx} className='flex items-center gap-2'>
              <Input
                className='flex-1'
                placeholder={isSupplements ? 'Value (e.g. Chocolate)' : 'Value (e.g. 100ml)'}
                value={vv.value}
                onChange={(e) => {
                  const updated = [...value.values];
                  updated[idx] = { ...vv, value: e.target.value };
                  onChange({ ...value, values: updated });
                }}
              />
              {showPriceModifiers && (
              <div className='flex items-center gap-1 w-36 flex-shrink-0'>
                <span className='text-xs text-muted-foreground'>+</span>
                <Input
                  type='number'
                  min={0}
                  placeholder='0'
                  className='w-full'
                  value={vv.priceModifier ?? 0}
                  onChange={(e) => {
                    const updated = [...value.values];
                    updated[idx] = { ...vv, priceModifier: Number(e.target.value) || 0 };
                    onChange({ ...value, values: updated });
                  }}
                />
                <span className='text-xs text-muted-foreground whitespace-nowrap'>EGP</span>
              </div>
              )}
              {/* Override toggle — only shown for globally-strikethrough values */}
              {isGloballyStruck && (
                <button
                  type='button'
                  title={isOverridden ? 'Currently enabled for this product (click to re-apply global strikethrough)' : 'Globally disabled — click to enable for this product only'}
                  onClick={() => {
                    const updated = [...value.values];
                    updated[idx] = { ...vv, enabledOverride: !isOverridden };
                    onChange({ ...value, values: updated });
                  }}
                  className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium transition-colors ${
                    isOverridden
                      ? 'border-green-500 text-green-600 bg-green-50 hover:bg-green-100'
                      : 'border-orange-400 text-orange-500 bg-orange-50 hover:bg-orange-100 line-through'
                  }`}>
                  {isOverridden ? 'ON' : 'OFF'}
                </button>
              )}
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='h-8 w-8 text-destructive hover:text-destructive flex-shrink-0'
                onClick={() => {
                  const updated = value.values.filter((_, i) => i !== idx);
                  onChange({ ...value, values: updated });
                }}>
                <XIcon className='w-3.5 h-3.5' />
              </Button>
            </div>
            );
          })}
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() =>
              onChange({
                ...value,
                values: [...value.values, { value: '', priceModifier: 0 }],
              })
            }>
            + Add Value
          </Button>
        </div>
        {showPriceModifiers && (
          <p className='text-xs text-muted-foreground'>
            Set a price modifier (e.g. +50 EGP for 100ml) — added on top of base price
          </p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Description Color Button
   Wraps the selected text in the description textarea with
   [color:#hex]...[/color] tags
   ═══════════════════════════════════════════════════════════════════ */

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
  "#000000",
];

function DescriptionColorButton({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customColor, setCustomColor] = useState("#000000");

  const applyColor = (color: string) => {
    const textarea = document.getElementById(
      "product-description-textarea",
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start === end) {
      // No selection — insert a placeholder
      const tag = `[color:${color}]colored text[/color]`;
      const newVal = value.slice(0, start) + tag + value.slice(end);
      onChange(newVal);
    } else {
      const selected = value.slice(start, end);
      const newVal =
        value.slice(0, start) +
        `[color:${color}]${selected}[/color]` +
        value.slice(end);
      onChange(newVal);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type='button' variant='outline' size='sm' className='h-7 px-2'>
          <Palette className='h-3.5 w-3.5 mr-1' />
          Color
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-52 p-3' align='start'>
        <div className='grid grid-cols-5 gap-1.5 mb-2'>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type='button'
              className='w-7 h-7 rounded-full border border-gray-200 hover:scale-110 transition-transform'
              style={{ backgroundColor: c }}
              onClick={() => applyColor(c)}
              aria-label={`Apply color ${c}`}
            />
          ))}
        </div>
        <div className='flex items-center gap-1.5'>
          <input
            type='color'
            value={customColor}
            onChange={(e) => setCustomColor(e.target.value)}
            className='w-7 h-7 rounded cursor-pointer border-0 p-0'
          />
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='flex-1 h-7 text-xs'
            onClick={() => applyColor(customColor)}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
