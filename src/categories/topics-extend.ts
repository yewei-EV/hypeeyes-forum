const _ = require('lodash');
const db = require('../database');
const plugins = require('../plugins');
const meta = require('../meta');

module.exports = function (Categories) {
    Categories.getTopicIdsInThisCategory = async function(data) {
        const dataForPinned = _.cloneDeep(data);
        dataForPinned.start = 0;
        dataForPinned.stop = -1;

        const [pinnedTids, set, direction] = await Promise.all([
            getPinnedTidsInThisCategory(dataForPinned),
            buildTopicsSortedSetInThisCategory(data),
            getSortedSetRangeDirectionInThisCategory(data.sort),
        ]);

        const totalPinnedCount = pinnedTids.length;
        const pinnedTidsOnPage = pinnedTids.slice(data.start, data.stop!== -1 ? data.stop + 1:undefined);
        const pinnedCountOnPage = pinnedTidsOnPage.length;
        const topicsPerPage = data.stop - data.start + 1;
        const normalTidsToGet = Math.max(0, topicsPerPage - pinnedCountOnPage);

        if (!normalTidsToGet && data.stop!== -1) {
            return pinnedTidsOnPage;
        }

        let start = data.start;
        if (start > 0 && totalPinnedCount) {
            start -= totalPinnedCount - pinnedCountOnPage;
        }

        const stop = data.stop=== -1 ? data.stop:start + normalTidsToGet - 1;
        let normalTids;
        const reverse = direction==='highest-to-lowest';
        if (Array.isArray(set)) {
            const weights = set.map(s => 1);
            normalTids = await db[reverse ? 'getSortedSetRevUnion':'getSortedSetUnion']({
                sets: set,
                start: start,
                stop: stop,
                weights: weights
            });
        } else {
            normalTids = await db[reverse ? 'getSortedSetRevRange':'getSortedSetRange'](set, start, stop);
        }
        normalTids = normalTids.filter(tid => !pinnedTids.includes(tid));
        return pinnedTidsOnPage.concat(normalTids);
    };

    Categories.getTopicCountInThisCategory = async function(data) {
        const set = await buildTopicsSortedSetInThisCategory(data);
        return await db.sortedSetUnionCard(set);
    };

    async function getCids(cid) {
        const cids = [];
        return cids;
    }

    async function buildTopicsSortedSetInThisCategory(data) {
        const cid = data.cid;
        let set = 'cid:' + cid + ':tids';
        const sort = data.sort || (data.settings && data.settings.categoryTopicSort) || meta.config.categoryTopicSort || 'newest_to_oldest';
        const cids = getCids(cid);

        if (sort === 'most_posts') {
            set = 'cid:' + cid + ':tids:posts';
        } else if (sort === 'most_votes') {
            set = 'cid:' + cid + ':tids:votes';
        }

        if (data.targetUid) {
            set = 'cid:' + cid + ':uid:' + data.targetUid + ':tids';
        }

        if (data.tag) {
            if (Array.isArray(data.tag)) {
                set = [set].concat(data.tag.map(tag => 'tag:' + tag + ':topics'));
            } else {
                set = [set, 'tag:' + data.tag + ':topics'];
            }
        }
        return set;
    }

    async function getPinnedTidsInThisCategory(data) {
        return await db.getSortedSetRevRange('cid:' + data.cid + ':tids:pinned', data.start, data.stop);
    }

    async function getSortedSetRangeDirectionInThisCategory(sort) {
        sort = sort || 'newest_to_oldest';
        const direction = sort === 'newest_to_oldest' || sort === 'most_posts' || sort === 'most_votes' ? 'highest-to-lowest' : 'lowest-to-highest';
        const result = {
            sort: sort,
            direction: direction,
        };
        return result && result.direction;
    }
};
