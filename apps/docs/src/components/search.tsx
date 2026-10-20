"use client"
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search"
import { useStaticSearch } from "fumadocs-core/search/client"
import { BASE_PATH } from "@/lib/base-path"

/** Searches the index exported at /docs/api/search; on the VPS a bare /api/search would reach the BugBerry app. */
export default function StaticSearchDialog(props: SharedProps) {
  const search = useStaticSearch({ from: `${BASE_PATH}/api/search` })

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  )
}
