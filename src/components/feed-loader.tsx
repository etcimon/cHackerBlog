"use client";

export function FeedLoader() {
  return (
    <div className="feed-loader" aria-live="polite" role="status">
      <div className="feed-loader__terminal">
        <span className="feed-loader__prompt">$</span>
        <span className="feed-loader__text">fetch feed</span>
        <span className="feed-loader__cursor" />
      </div>
      <div className="feed-loader__bar" aria-hidden="true">
        <span className="feed-loader__bar-fill" />
      </div>
      <div className="feed-loader__dots" aria-hidden="true">
        <span className="feed-loader__dot" />
        <span className="feed-loader__dot" />
        <span className="feed-loader__dot" />
        <span className="feed-loader__dot" />
        <span className="feed-loader__dot" />
      </div>
    </div>
  );
}
