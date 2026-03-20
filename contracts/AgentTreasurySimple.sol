// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentTreasury
 * @notice Simple treasury for AOX agents to hold yield-bearing tokens
 * @dev Designed for wstETH and other tokens on Base
 */
contract AgentTreasury {
    address public owner;
    
    // Supported tokens
    mapping(address => bool) public supportedTokens;
    
    // Token balances per depositor
    mapping(address => mapping(address => uint256)) public balances;
    
    // Total token holdings
    mapping(address => uint256) public totalDeposits;

    // Events
    event Deposit(address indexed token, address indexed depositor, uint256 amount);
    event Withdrawal(address indexed token, address indexed recipient, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // Constructor
    constructor(address _owner) {
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    // ERC20 interface
    function transferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }

    function transfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }

    function balanceOfToken(address token, address account) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x70a08231, account));
        require(success, "Balance check failed");
        return abi.decode(data, (uint256));
    }

    /**
     * @notice Add supported token
     */
    function addSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = true;
    }

    /**
     * @notice Remove supported token
     */
    function removeSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = false;
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Deposit tokens
     */
    function deposit(address token, uint256 amount) external {
        require(supportedTokens[token], "Token not supported");
        require(amount > 0, "Amount must be > 0");
        
        uint256 balanceBefore = balanceOfToken(token, address(this));
        transferFrom(token, msg.sender, address(this), amount);
        uint256 balanceAfter = balanceOfToken(token, address(this));
        uint256 actualAmount = balanceAfter - balanceBefore;
        
        balances[token][msg.sender] += actualAmount;
        totalDeposits[token] += actualAmount;
        
        emit Deposit(token, msg.sender, actualAmount);
    }

    /**
     * @notice Withdraw tokens
     */
    function withdraw(address token, uint256 amount) external {
        require(balances[token][msg.sender] >= amount, "Insufficient balance");
        
        balances[token][msg.sender] -= amount;
        totalDeposits[token] -= amount;
        
        transfer(token, msg.sender, amount);
        
        emit Withdrawal(token, msg.sender, amount);
    }

    /**
     * @notice Emergency withdraw by owner
     */
    function emergencyWithdraw(address token, address recipient, uint256 amount) external onlyOwner {
        transfer(token, recipient, amount);
    }

    /**
     * @notice Get balance
     */
    function getBalance(address token, address depositor) external view returns (uint256) {
        return balances[token][depositor];
    }

    /**
     * @notice Check if token is supported
     */
    function isSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    /**
     * @notice Get contract token balance
     */
    function getContractBalance(address token) external view returns (uint256) {
        return balanceOfToken(token, address(this));
    }

    // Receive ETH
    receive() external payable {}
}
