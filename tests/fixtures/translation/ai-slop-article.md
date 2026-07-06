The most inconvenient aspect of having your code written by AI is when the slop meets the unit test. There's a tendency in Claude to use Regex but it sums itself up into being unable to think about all the corner cases it should test against. About $15 later and a little annoyance about the dead end, you're thinking about cutting losses like a gambling addict.

When do I e.g. constrain it to a state machine, or when has it rewritten the same algorithms again and again enough to warrant a little more study? For the purpose of this article we can look into the sizing markdown feature for Code Blocks of this blog platform...

--END PREVIEW--

This article assumes one has experience with using agents in an IDE such as [Devin](https://devin.ai) for automated coding.

Here is a "clever" markdown parser solved through AI:

```ts medium preview=15
/**
 * State machine parser for size specifications in markdown embed tags.
 * Parses formats like:
 * - "640x360" -> { type: "pixels", width: 640, height: 360 }
 * - "50%" -> { type: "percent", width: 50 }
 * - "small" -> { type: "preset", size: "small" }
 * - "width=640" -> { type: "pixels", width: 640, height: 0 }
 * - "width=640 height=360" -> { type: "pixels", width: 640, height: 360 }
 */
export function parseSizeSpec(input: string): EmbedSize {
  const trimmed = input.trim();
  if (!trimmed) return { type: "none" };

  // State machine states
  type State =
    | "start"
    | "digit"
    | "after_digit"
    | "x"
    | "after_x"
    | "percent"
    | "preset"
    | "named_key"
    | "named_equals"
    | "named_value"
    | "named_after_value"
    | "space";

  let state: State = "start";
  let width = 0;
  let height = 0;
  let currentNumber = "";
  let currentKey = "";
  let presetName = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    switch (state) {
      case "start":
        if (char >= "0" && char <= "9") {
          state = "digit";
          currentNumber = char;
        } else if (char === "s" || char === "S") {
          state = "preset";
          presetName = char.toLowerCase();
        } else if (char === "m" || char === "M") {
          state = "preset";
          presetName = char.toLowerCase();
        } else if (char === "l" || char === "L") {
          state = "preset";
          presetName = char.toLowerCase();
        } else if (char === "w" || char === "W") {
          state = "named_key";
          currentKey = char.toLowerCase();
        } else if (char === " ") {
          state = "space";
        } else {
          return { type: "none" };
        }
        break;

      case "digit":
        if (char >= "0" && char <= "9") {
          currentNumber += char;
        } else if (char === "x" || char === "X") {
          width = parseInt(currentNumber, 10);
          state = "x";
          currentNumber = "";
        } else if (char === "%") {
          width = parseInt(currentNumber, 10);
          return { type: "percent", width };
        } else if (char === " ") {
          width = parseInt(currentNumber, 10);
          state = "after_digit";
          currentNumber = "";
        } else {
          return { type: "none" };
        }
        break;

      case "after_digit":
        if (char === "x" || char === "X") {
          state = "x";
        } else if (char === " ") {
          // continue
        } else {
          return { type: "none" };
        }
        break;

      case "x":
        if (char >= "0" && char <= "9") {
          state = "after_x";
          currentNumber = char;
        } else if (char === " ") {
          // continue
        } else {
          return { type: "none" };
        }
        break;

      case "after_x":
        if (char >= "0" && char <= "9") {
          currentNumber += char;
        } else if (char === " " || i === trimmed.length - 1) {
          height = parseInt(currentNumber, 10);
          state = "space";
        } else {
          return { type: "none" };
        }
        break;


      case "preset":
        if (char >= "a" && char <= "z") {
          presetName += char;
        } else if (char === " " || i === trimmed.length - 1) {
          if (presetName === "small" || presetName === "medium" || presetName === "large") {
            return { type: "preset", size: presetName as "small" | "medium" | "large" };
          }
          return { type: "none" };
        } else {
          return { type: "none" };
        }
        break;

      case "named_key":
        if (char >= "a" && char <= "z") {
          currentKey += char;
        } else if (char === "=") {
          state = "named_equals";
        } else {
          return { type: "none" };
        }
        break;

      case "named_equals":
        if (char >= "0" && char <= "9") {
          state = "named_value";
          currentNumber = char;
        } else {
          return { type: "none" };
        }
        break;

      case "named_value":
        if (char >= "0" && char <= "9") {
          currentNumber += char;
        } else if (char === " " || i === trimmed.length - 1) {
          const value = parseInt(currentNumber, 10);
          if (currentKey === "width") {
            width = value;
          } else if (currentKey === "height") {
            height = value;
          }
          currentKey = "";
          currentNumber = "";
          state = "named_after_value";
        } else {
          return { type: "none" };
        }
        break;

      case "named_after_value":
        if (char === " ") {
          // continue
        } else if (char >= "a" && char <= "z") {
          state = "named_key";
          currentKey = char.toLowerCase();
        } else {
          return { type: "none" };
        }
        break;

      case "space":
        if (char === " ") {
          // continue
        } else if (char >= "0" && char <= "9") {
          state = "digit";
          currentNumber = char;
        } else if (char === "s" || char === "S" || char === "m" || char === "M" || char === "l" || char === "L") {
          state = "preset";
          presetName = char.toLowerCase();
        } else if (char === "w" || char === "W") {
          state = "named_key";
          currentKey = char.toLowerCase();
        } else {
          return { type: "none" };
        }
        break;
    }
  }

  // Handle end of string
  if (state === "digit") {
    width = parseInt(currentNumber, 10);
    return { type: "pixels", width, height: 0 };
  }
  if (state === "after_x") {
    height = parseInt(currentNumber, 10);
    return { type: "pixels", width, height };
  }
  if (state === "preset") {
    if (presetName === "small" || presetName === "medium" || presetName === "large") {
      return { type: "preset", size: presetName as "small" | "medium" | "large" };
    }
    return { type: "none" };
  }
  if (state === "named_value") {
    const value = parseInt(currentNumber, 10);
    if (currentKey === "width") {
      width = value;
    } else if (currentKey === "height") {
      height = value;
    }
    return { type: "pixels", width, height };
  }

  return { type: "none" };
}
```

The result is a `highlightjs` feature with dozens of themes and a custom markdown that supports tons of languages, sizes and previews for code blocks which lazily loads the js/css; but even as a trained AI developer, the prompt needed to be fixed multiple times after drifting into regex. Is it better to let a free model have a go first? Should I ask for architectural analysis to get a sense of whether there's design choices that were omitted?

In any case, a developer who doesn't know how it should be done or what would be expected of a proper solution through studying programming language compilers would be trying random solutions. It's often useful to ask the AI how a specific feature could be implemented but you would inevitably fall into the "Let me try something else" pitfall when unit tests prove that the implementation is incompatible with corner cases. 

More explicit and basic programming methods are usually the best, but when is the trade-off of importing libraries worth the shot?![](/api/uploads/1783255385777-6ea15b625995.jpg)The matter of fact is, you can't give up the challenge of solving all the design decisions and leave it to AI without the code getting lost in unforeseen collisions. Ideally, you should have the entire architecture and implementation details figured out **before** just letting Claude have a go at it. And the unit tests remain an idea way to constrain the development on a certain task.

```ts large preview=10

  it("buildImageMarkdown should omit braces when size is none", () => {
    const md = buildImageMarkdown({
      alt: "photo",
      src: "http://example.com/p.png",
      size: { type: "none" },
    });
    expect(md).toBe("![photo](http://example.com/p.png)");
  });

  it("buildImageHtml should carry data attributes for round-trip", () => {
    const html = buildImageHtml({
      alt: "photo",
      src: "http://example.com/p.png",
      size: { type: "preset", size: "small" },
    });
    expect(html).toContain('data-cb-img="1"');
    expect(html).toContain('data-size="small"');
    expect(html).toContain("cb-img--size-small");
  });
```

In many cases, the ideal direction for the code and the bugs are interlaced through the unit tests you designed firsthand in full expectation of what the tools will have been.

If design choices were right, a good Prompt Engineer would use Claude for macro design challenges where beautiful interactive UI is needed, and leverage a free model such as SWE 1.6 to tinker about the corner cases, saving a lot on paid tokens.

```plaintext medium
"Could you design the architecture modifications and patterns in logisplain to implement a web url link embedding algorithm in the wysiwyg which is consistent and builds on the markdown for local embeds with sizes feature, in defaulting to a preview under the link building on file embeds but detecting an external URL with a html content-type instead of a file, where info is pulled from the link destination through an api endpoint which loads the page and returns the proper elements for a thumbnail, title and url by default, but would use custom-designed embed feature with a common ext-embeds lib and specific code paths for youtube, vimeo, rumble, twitch, x, facebook, instagram, soundcloud, youtube music, at first, by researching each site's typical embed code and setting the variables from the path, preserving sizing feature but with an added urlOnly parameter to disable the preview, answering with the embed codes and programming strategy in an optimal code reuse scenario considering also the roundtrip test?"
```

This emphasis on programming strategies and pulling AI through the thought process can result in much more efficient solutions.

```plaintext medium
Embed external URLs with rich provider embeds or generic link previews using the @[](url) syntax:

@[](https://www.youtube.com/watch?v=Z_UOmAed5O8)
@[](https://soundcloud.com/artist/track)
@[](https://example.com/some-post)

Supported Providers

Rich embeds are automatically rendered for these platforms:

    YouTube / YouTube Music – video player
    Vimeo – video player
    Rumble – video player
    Twitch – video player (clips, VODs, channels)
    X (Twitter) – tweet embed
    Facebook – post/video embed
    Instagram – post/reel embed
    SoundCloud – audio player
```

Once the features are built, your AI understands even what it takes to write a `README.md` entry about it. If you want to play around with this blog, the Github repo is over [here](https://github.com/etcimon/cHackerBlog)
