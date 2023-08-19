// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   WomDepositor
 * @notice  Deposit WOM in staker contract once in smartLockPeriod.
            Have customLockDays mapping for instant custom deposits with specific days count.
 */
contract WomDepositor is Ownable {
    using SafeERC20 for IERC20;
    using Address for address;

    address public wom;
    address public staker;
    address public minter;
    address public booster;
    uint256 public earmarkPid;

    uint256 public lockDays;
    uint256 public smartLockPeriod;

    uint256 public checkOldSlot;
    uint256 public currentSlot;
    uint256 public lastLockAt;
    bool public executing;

    mapping(uint256 => uint256) public slotEnds;
    mapping(address => uint256) public customLockDays;
    mapping(address => uint256) public customLockMinAmount;
    mapping(uint256 => bool) public lockedCustomSlots;
    mapping(uint256 => bool) public releasedCustomSlots;

    address[] public customLockAccounts;

    struct SlotInfo {
        uint256 number;
        uint256 amount;
    }
    mapping(address => SlotInfo[]) public customLockSlots;

    event UpdateOperator(address operator);
    event SetLockConfig(uint256 lockDays, uint256 smartLockPeriod);
    event SetBooster(address booster, uint256 pid);
    event SetCustomLockDays(address indexed account, uint256 lockDays, uint256 minAmount);
    event Deposit(address indexed account, address stakeAddress, uint256 amount);
    event SmartLockReleased(address indexed sender, uint256 indexed slot);
    event SmartLockCheck(address indexed sender, uint256 indexed checkOldSlot, bool isLockedCustomSlot);
    event SmartLock(address indexed sender, bool indexed customLockDays, uint256 indexed slot, uint256 amountToLock, uint256 senderLockDays, uint256 currentSlot, uint256 checkOldSlot);
    event ReleaseCustomLock(address indexed sender, uint256 index, uint256 indexed slot, uint256 amount);

    /**
     * @param _wom              WOM Token address
     * @param _staker           Voter Proxy address
     * @param _minter           Minter
     */
    constructor(
        address _wom,
        address _staker,
        address _minter,
        address _booster
    ) public {
        wom = _wom;
        staker = _staker;
        minter = _minter;
        booster = _booster;
    }

    function setLockConfig(uint256 _lockDays, uint256 _smartLockPeriod) external onlyOwner {
        lockDays = _lockDays;
        smartLockPeriod = _smartLockPeriod;

        emit SetLockConfig(_lockDays, _smartLockPeriod);
    }

    function setBooster(address _booster, uint256 _earmarkPid) external onlyOwner {
        booster = _booster;
        earmarkPid = _earmarkPid;

        emit SetBooster(_booster, _earmarkPid);
    }

    function updateMinterOperator() external onlyOwner {
        address depositor = IStaker(staker).depositor();
        ITokenMinter(minter).setOperator(depositor);
        emit UpdateOperator(depositor);
    }

    /**
     * @notice  Set custom lock options for specific account
     * @param _account      Account of spender
     * @param _lockDays     Specific days to lock WOM amount
     * @param _minAmount    Minimum amount to lock by spender
     */
    function setCustomLock(address _account, uint256 _lockDays, uint256 _minAmount) external onlyOwner {
        _setCustomLock(_account, _lockDays, _minAmount);
    }

    function _setCustomLock(address _account, uint256 _lockDays, uint256 _minAmount) internal {
        if (customLockMinAmount[_account] == 0) {
            customLockAccounts.push(_account);
        }
        customLockDays[_account] = _lockDays;
        customLockMinAmount[_account] = _minAmount;

        emit SetCustomLockDays(_account, _lockDays, _minAmount);
    }

    function deposit(
        uint256 _amount,
        uint256,
        bool,
        address _stakeAddress
    ) external {
        deposit(_amount, _stakeAddress);
    }

    function deposit(
        uint256 _amount,
        bool,
        address _stakeAddress
    ) external {
        deposit(_amount, _stakeAddress);
    }

    /**
     * @notice  Deposit tokens into the VeWom and mint WmxWom to depositors.
     * @param _amount  Amount WOM to deposit
     * @param _stakeAddress  Staker to deposit WmxWom
     */
    function deposit(uint256 _amount, address _stakeAddress) public returns (bool) {
        require(customLockDays[msg.sender] == 0, "custom");

        _smartLock(_amount);

        bool depositOnly = _stakeAddress == address(0);
        if(depositOnly){
            //mint for to
            ITokenMinter(minter).mint(msg.sender, _amount);
        }else{
            //mint here
            ITokenMinter(minter).mint(address(this), _amount);
            //stake for to
            IERC20(minter).safeApprove(_stakeAddress, 0);
            IERC20(minter).safeApprove(_stakeAddress, _amount);
            IRewards(_stakeAddress).stakeFor(msg.sender, _amount);
        }
        emit Deposit(msg.sender, _stakeAddress, _amount);
        return true;
    }

    /**
     * @notice  Trying to releaseLock every time on deposit and lock cumulative balance once in smartLockPeriod.
     * @param _amount  Amount WOM to deposit
     */
    function _smartLock(uint256 _amount) internal virtual {
        IERC20(wom).transferFrom(msg.sender, address(this), _amount);

        if (currentSlot > 1 && checkOldSlot >= currentSlot - 1) {
            checkOldSlot = 0;
        }

        if (slotEnds[checkOldSlot] != 0 && slotEnds[checkOldSlot] < block.timestamp) {
            if (!lockedCustomSlots[checkOldSlot]) {
                IStaker(staker).releaseLock(checkOldSlot);
                slotEnds[checkOldSlot] = slotEnds[currentSlot - 1];
                currentSlot = currentSlot - 1;
                emit SmartLockReleased(msg.sender, checkOldSlot);
            }
            checkOldSlot = checkOldSlot + 1;
            emit SmartLockCheck(msg.sender, checkOldSlot, lockedCustomSlots[checkOldSlot]);
        }

        if (executing || (lastLockAt + smartLockPeriod > block.timestamp && customLockDays[msg.sender] == 0)) {
            return;
        }
        executing = true;

        if (IERC20(wom).balanceOf(staker) > 0) {
            IBooster(booster).earmarkRewards(earmarkPid);
        }

        uint256 slot = currentSlot;
        currentSlot = currentSlot + 1;

        uint256 senderLockDays = lockDays;
        uint256 amountToLock = _amount;
        if (customLockDays[msg.sender] > 0) {
            senderLockDays = customLockDays[msg.sender];
            customLockSlots[msg.sender].push(SlotInfo(slot, _amount));
            lockedCustomSlots[slot] = true;
        } else {
            amountToLock = IERC20(wom).balanceOf(address(this));
        }

        IERC20(wom).safeTransfer(staker, amountToLock);
        IStaker(staker).lock(senderLockDays);

        slotEnds[slot] = block.timestamp + senderLockDays * 86400;

        lastLockAt = block.timestamp;

        executing = false;
        emit SmartLock(msg.sender, customLockDays[msg.sender] > 0, slot, amountToLock, senderLockDays, currentSlot, checkOldSlot);
    }

    /**
     * @notice  Deposit tokens into the VeWom by custom lock options.
     * @param _amount  Amount WOM to deposit
     */
    function depositCustomLock(uint256 _amount) public {
        require(customLockDays[msg.sender] > 0, "!custom");
        require(_amount >= customLockMinAmount[msg.sender], "<customLockMinAmount");
        _smartLock(_amount);
    }

    /**
     * @notice  Release locked tokens from specific slot
     * @param _index  Index of account slots
     */
    function releaseCustomLock(uint256 _index) public {
        SlotInfo memory slot = customLockSlots[msg.sender][_index];

        require(slotEnds[slot.number] < block.timestamp, "!ends");

        IStaker(staker).releaseLock(slot.number);
        IERC20(wom).safeTransfer(msg.sender, slot.amount);

        lockedCustomSlots[slot.number] = false;
        slotEnds[slot.number] = slotEnds[currentSlot - 1];

        checkOldSlot = slot.number + 1;

        uint256 len = customLockSlots[msg.sender].length;
        if (_index != len - 1) {
            customLockSlots[msg.sender][_index] = customLockSlots[msg.sender][len - 1];
        }
        customLockSlots[msg.sender].pop();

        currentSlot = currentSlot - 1;

        emit ReleaseCustomLock(msg.sender, _index, slot.number, slot.amount);
    }

    function getCustomLockAccounts() public view returns (address[] memory) {
        return customLockAccounts;
    }

    function getCustomLockSlotsLength(address _account) public view returns (uint256) {
        return customLockSlots[_account].length;
    }

    /**
     * @notice  Rescue all tokens but wom from contract
     * @param _tokens       Tokens addresses
     * @param _recipient    Recipient address
     */
    function rescueTokens(address[] memory _tokens, address _recipient) public onlyOwner {
        for (uint256 i; i < _tokens.length; i++) {
            require(_tokens[i] != wom, "!wom");
            IERC20(_tokens[i]).safeTransfer(_recipient, IERC20(_tokens[i]).balanceOf(address(this)));
        }
    }
}
