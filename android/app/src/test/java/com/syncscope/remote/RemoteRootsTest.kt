package com.syncscope.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** The repository's remote folders (research R11): normalization, overlap, validation and storage. */
class RemoteRootsTest {

  // --- normalize ---

  @Test
  fun normalizeTrimsAddsALeadingSlashCollapsesAndDropsTheTrailingSlash() {
    assertEquals("/photos", RemoteRoots.normalize(" photos/ "))
    assertEquals("/photos/2024", RemoteRoots.normalize("//photos///2024//"))
    assertEquals("/photos", RemoteRoots.normalize("/photos"))
    assertEquals("/", RemoteRoots.normalize("/"))
    assertEquals("/", RemoteRoots.normalize("  //  "))
  }

  // --- overlapOf ---

  @Test
  fun equalAndNestedFoldersOverlapAtASlashBoundary() {
    assertEquals(RemoteRoots.Overlap(1, "/photos"), RemoteRoots.overlapOf(listOf("/photos", "/photos/2024")))
    assertEquals(RemoteRoots.Overlap(1, "/photos/2024"), RemoteRoots.overlapOf(listOf("/photos/2024", "/photos")))
    assertEquals(RemoteRoots.Overlap(1, "/photos"), RemoteRoots.overlapOf(listOf("/photos", "/photos")))
    assertEquals(RemoteRoots.Overlap(2, "/a"), RemoteRoots.overlapOf(listOf("/a", "/b", "/a/c")))
    assertEquals(RemoteRoots.Overlap(1, "/"), RemoteRoots.overlapOf(listOf("/", "/photos")))
  }

  @Test
  fun aSharedPrefixWithoutASlashBoundaryIsNoOverlap() {
    assertNull(RemoteRoots.overlapOf(listOf("/photos", "/photos2")))
    assertNull(RemoteRoots.overlapOf(listOf("/photos2", "/photos")))
    assertNull(RemoteRoots.overlapOf(listOf("/a", "/b", "/c/a")))
    assertNull(RemoteRoots.overlapOf(listOf("/only")))
  }

  @Test
  fun overlapReportsTheFirstEarlierFolderForTheFirstLaterIndex() {
    assertEquals(RemoteRoots.Overlap(1, "/a"), RemoteRoots.overlapOf(listOf("/a", "/a/b", "/a/b/c")))
    assertEquals(RemoteRoots.Overlap(2, "/a"), RemoteRoots.overlapOf(listOf("/a", "/b", "/a/b", "/b/c")))
  }

  // --- validate ---

  @Test
  fun validReturnsTheNormalizedListInOrder() {
    assertEquals(
      RemoteRoots.Validation.Valid(listOf("/scan/clean/a", "/scan/clean/b")),
      RemoteRoots.validate(listOf(" scan/clean/a/ ", "/scan//clean/b")),
    )
  }

  @Test
  fun anEmptyOrAllBlankListIsAnErrorAtIndexZero() {
    for (roots in listOf(emptyList(), listOf(""), listOf("  ", "\t"))) {
      assertEquals(
        roots.toString(),
        RemoteRoots.Validation.Invalid(0, RemoteRoots.MESSAGE_EMPTY),
        RemoteRoots.validate(roots),
      )
    }
    assertEquals("Add at least one remote folder.", RemoteRoots.MESSAGE_EMPTY)
  }

  @Test
  fun blankEntriesNextToARealFolderAreDropped() {
    assertEquals(RemoteRoots.Validation.Valid(listOf("/a")), RemoteRoots.validate(listOf("", "/a", " ")))
  }

  @Test
  fun aFolderWithALineBreakIsRejectedAtItsIndex() {
    assertEquals(
      RemoteRoots.Validation.Invalid(1, "A folder name cannot contain a line break."),
      RemoteRoots.validate(listOf("/a", "/b\n/c")),
    )
    assertEquals(
      RemoteRoots.Validation.Invalid(0, RemoteRoots.MESSAGE_LINE_BREAK),
      RemoteRoots.validate(listOf("/b\r")),
    )
  }

  @Test
  fun anOverlapIsRejectedAtTheLaterIndexNamingTheEarlierFolder() {
    assertEquals(
      RemoteRoots.Validation.Invalid(1, "This folder is the same as, inside or around /scan/clean/a."),
      RemoteRoots.validate(listOf("/scan/clean/a", "/scan/clean/a/x")),
    )
    assertEquals(
      RemoteRoots.Validation.Invalid(2, "This folder is the same as, inside or around /b/c."),
      RemoteRoots.validate(listOf("/a", "/b/c", "b/")),
    )
  }

  @Test
  fun theFirstFieldErrorWins() {
    assertEquals(
      RemoteRoots.Validation.Invalid(1, RemoteRoots.MESSAGE_LINE_BREAK),
      RemoteRoots.validate(listOf("/a", "/x\ny", "/a")),
    )
  }

  @Test
  fun relativeSegmentsControlCharactersAndOverlongPathsAreRejected() {
    assertEquals(RemoteRoots.Validation.Invalid(0, RemoteRoots.MESSAGE_RELATIVE), RemoteRoots.validate(listOf("/photos/../etc")))
    assertEquals(RemoteRoots.Validation.Invalid(1, RemoteRoots.MESSAGE_RELATIVE), RemoteRoots.validate(listOf("/a", "./b")))
    assertEquals(RemoteRoots.Validation.Invalid(0, RemoteRoots.MESSAGE_UNSUPPORTED), RemoteRoots.validate(listOf("/a\u0000b")))
    assertEquals(
      RemoteRoots.Validation.Invalid(0, RemoteRoots.MESSAGE_TOO_LONG),
      RemoteRoots.validate(listOf("/" + "x".repeat(RemoteRoots.MAX_LENGTH))),
    )
  }

  // --- encode / decode ---

  @Test
  fun encodeAndDecodeRoundTripAndKeepOrder() {
    val roots = listOf("/z", "/a", "/m/n")
    assertEquals(roots, RemoteRoots.decode(RemoteRoots.encode(roots)))
    assertEquals("/z\n/a\n/m/n", RemoteRoots.encode(roots))
    assertEquals(listOf("/photos"), RemoteRoots.decode("/photos"))
  }

  @Test
  fun encodeRefusesAFolderWithALineBreak() {
    assertThrows(IllegalArgumentException::class.java) { RemoteRoots.encode(listOf("/a\nb")) }
  }
}
